import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { emailQueue, parentQueue } from '../lib/queue';
import { processImage } from '../lib/imageProcessor';

const router = Router();
const prisma = new PrismaClient();

// ─── Upload directory ─────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'manual');

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

// ~2MB limit as base64 string: 2MB * 4/3 ≈ 2.73MB string, round to 3MB
const MAX_PHOTO_STRING_LEN = 3 * 1024 * 1024;

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const manualMarkSchema = z.object({
  studentId: z.string().min(1),
  photoDataUrl: z
    .string()
    .max(MAX_PHOTO_STRING_LEN, 'Photo exceeds 2MB limit')
    .optional(),
});

const approveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});

// ─── POST /api/sessions/:id/manual ───────────────────────────────────────────
// Officer-auth: student JWT + officer membership check done inline (session→room→officer)

router.post(
  '/:id/manual',
  requireAuth('student'),
  async (req: Request, res: Response): Promise<void> => {
    const officerStudentId = req.user!.id;
    const sessionId = req.params.id;

    // 1. Validate body
    const parsed = manualMarkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const { studentId, photoDataUrl } = parsed.data;

    // 2. Load session + room
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { room: true },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // 3. Check officer membership in this room (inline — avoids modifying requireOfficer)
    const officerMember = await prisma.roomMember.findFirst({
      where: {
        student_id: officerStudentId,
        room_id: session.room_id,
        role: 'officer',
      },
    });
    if (!officerMember) {
      res.status(403).json({ error: 'Forbidden: officer role required' });
      return;
    }

    // 4. Validate student is enrolled in this room
    const studentMember = await prisma.roomMember.findUnique({
      where: {
        room_id_student_id: {
          room_id: session.room_id,
          student_id: studentId,
        },
      },
    });
    if (!studentMember) {
      res.status(404).json({ error: 'Student not enrolled in this room' });
      return;
    }

    // 5. Duplicate check: student already has approved or pending record in this session
    const existing = await prisma.attendanceRecord.findFirst({
      where: {
        session_id: sessionId,
        student_id: studentId,
        approval_status: { in: ['approved', 'pending'] },
      },
    });
    if (existing) {
      res.status(409).json({ error: 'Student already recorded in this session' });
      return;
    }

    // 6. Determine approval status
    const approvalStatus = session.room.require_manual_approval ? 'pending' : 'approved';

    // 7. Handle photo: decode, validate, process, save
    let selfieUrl: string | null = null;
    if (photoDataUrl) {
      // Strip data URI prefix if present: "data:image/jpeg;base64,..."
      const base64Match = photoDataUrl.match(/^data:[^;]+;base64,(.+)$/);
      const base64Data = base64Match ? base64Match[1] : photoDataUrl;

      let photoBuffer: Buffer;
      try {
        photoBuffer = Buffer.from(base64Data, 'base64');
      } catch {
        res.status(400).json({ error: 'Invalid base64 photo data' });
        return;
      }

      let processed: Awaited<ReturnType<typeof processImage>>;
      try {
        processed = await processImage(photoBuffer);
      } catch {
        res.status(400).json({ error: 'Invalid image: must be JPEG, PNG, or WebP' });
        return;
      }

      const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const filename = `manual-${tempId}.webp`;

      ensureUploadDir();
      const filePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, processed.buffer);
      selfieUrl = `uploads/manual/${filename}`;
    }

    // 8. Create attendance record
    const record = await prisma.attendanceRecord.create({
      data: {
        session_id: sessionId,
        student_id: studentId,
        method: 'manual',
        marked_by_officer_id: officerStudentId,
        approval_status: approvalStatus,
        selfie_url: selfieUrl,
        risk_score: 'low',
        risk_signals: [] as unknown as Prisma.InputJsonValue,
        location_flag: 'unverified',
        device_fingerprint: (req.headers['user-agent'] as string) ?? null,
        ip_address:
          (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
          req.socket.remoteAddress ??
          null,
        gps_readings: [] as unknown as Prisma.InputJsonValue,
        student_lat: null,
        student_lng: null,
        student_accuracy: null,
      },
    });

    // 9. Queue notifications
    if (approvalStatus === 'pending') {
      emailQueue
        .add('teacher-approval-needed', {
          type: 'teacher-approval-needed',
          recordId: record.id,
          roomId: session.room_id,
          teacherId: session.room.teacher_id,
        })
        .catch(() => {});
    } else {
      parentQueue.add('parent-notification', { recordId: record.id }).catch(() => {});
    }

    // 10. Return
    const status = approvalStatus === 'pending' ? 'pending_approval' : 'recorded';
    res.status(201).json({ record, status });
  },
);

// ─── PATCH /api/sessions/:sessionId/records/:recordId/approve ────────────────
// Teacher-auth

router.patch(
  '/:sessionId/records/:recordId/approve',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = req.user!.id;
    const { sessionId, recordId } = req.params;

    // 1. Validate body
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const { decision } = parsed.data;

    // 2. Verify session belongs to a room owned by the requesting teacher
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { room: { select: { teacher_id: true } } },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.room.teacher_id !== teacherId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // 3. Find the record
    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    if (!record || record.session_id !== sessionId) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    // 4. Guard: must be pending
    if (record.approval_status !== 'pending') {
      res.status(400).json({ error: 'Record is not pending — already decided' });
      return;
    }

    // 5. Update
    const updated = await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: { approval_status: decision },
    });

    // 6. Queue parent email if approved
    if (decision === 'approved') {
      parentQueue.add('parent-notification', { recordId: record.id }).catch(() => {});
    }

    res.json(updated);
  },
);

// ─── GET /api/sessions/:id/records/manual ────────────────────────────────────
// Teacher-auth

router.get(
  '/:id/records/manual',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = req.user!.id;
    const sessionId = req.params.id;

    // Verify session belongs to teacher
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { room: { select: { teacher_id: true } } },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.room.teacher_id !== teacherId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const records = await prisma.attendanceRecord.findMany({
      where: {
        session_id: sessionId,
        method: 'manual',
      },
      include: {
        student: { select: { id: true, name: true } },
      },
      orderBy: { scanned_at: 'desc' },
    });

    // Resolve officer names for each record
    const officerIds = [...new Set(records.map((r) => r.marked_by_officer_id).filter(Boolean) as string[])];
    const officers = officerIds.length
      ? await prisma.student.findMany({
          where: { id: { in: officerIds } },
          select: { id: true, name: true },
        })
      : [];
    const officerMap = new Map(officers.map((o) => [o.id, o.name]));

    const result = records.map((r) => ({
      id: r.id,
      student: r.student,
      officer_name: r.marked_by_officer_id ? (officerMap.get(r.marked_by_officer_id) ?? null) : null,
      method: r.method,
      approval_status: r.approval_status,
      selfie_url: r.selfie_url,
      scanned_at: r.scanned_at,
    }));

    res.json(result);
  },
);

// ─── GET /api/sessions/:id/absent-roster — officer-auth ─────────────────────
// Returns enrolled students who don't yet have an approved/pending record.

router.get(
  '/:id/absent-roster',
  requireAuth('student'),
  async (req: Request, res: Response): Promise<void> => {
    const officerStudentId = req.user!.id;
    const sessionId = req.params.id;

    // Load session
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { room: true },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Officer guard
    const officerMember = await prisma.roomMember.findFirst({
      where: { student_id: officerStudentId, room_id: session.room_id, role: 'officer' },
    });
    if (!officerMember) {
      res.status(403).json({ error: 'Forbidden: officer role required' });
      return;
    }

    // All enrolled students in this room
    const enrolled = await prisma.roomMember.findMany({
      where: { room_id: session.room_id },
      include: { student: { select: { id: true, name: true } } },
    });

    // Students already recorded (approved or pending)
    const recorded = await prisma.attendanceRecord.findMany({
      where: { session_id: sessionId, approval_status: { in: ['approved', 'pending'] } },
      select: { student_id: true },
    });
    const recordedIds = new Set(recorded.map((r) => r.student_id));

    const absent = enrolled
      .filter((m) => !recordedIds.has(m.student_id))
      .map((m) => ({ id: m.student_id, name: m.student.name }));

    res.json(absent);
  },
);

export default router;
