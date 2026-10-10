import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// ─── Shared pagination schema ─────────────────────────────────────────────────

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── GET /api/rooms/:id/sessions — list sessions for a room ──────────────────

const roomSessionsRouter = Router({ mergeParams: true });

roomSessionsRouter.get(
  '/sessions',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = req.user!.id;
    const roomId = (req.params as { id: string }).id;

    // Verify room belongs to teacher
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    if (room.teacher_id !== teacherId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() });
      return;
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      prisma.attendanceSession.findMany({
        where: { room_id: roomId },
        orderBy: { started_at: 'desc' },
        skip,
        take: limit,
        include: {
          records: {
            select: {
              approval_status: true,
              location_flag: true,
              risk_score: true,
            },
          },
        },
      }),
      prisma.attendanceSession.count({ where: { room_id: roomId } }),
    ]);

    const result = sessions.map((s) => {
      const presentCount = s.records.filter((r) => r.approval_status === 'approved').length;
      const flaggedCount = s.records.filter(
        (r) =>
          r.location_flag === 'mismatch' ||
          r.risk_score === 'medium' ||
          r.risk_score === 'high',
      ).length;
      const pendingApprovalCount = s.records.filter((r) => r.approval_status === 'pending').length;
      return {
        id: s.id,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at,
        presentCount,
        flaggedCount,
        pendingApprovalCount,
      };
    });

    res.json({
      data: result,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  },
);

// ─── GET /api/sessions/:id/records — paginated records for a session ──────────

const filterSchema = z.object({
  filter: z.enum(['all', 'flagged', 'pending_approval']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const sessionRecordsRouter = Router({ mergeParams: true });

sessionRecordsRouter.get(
  '/:id/records',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = req.user!.id;
    const sessionId = req.params.id;

    // Verify session's room belongs to teacher
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

    const parsed = filterSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() });
      return;
    }
    const { filter, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // Build where clause based on filter
    let filterWhere: Prisma.AttendanceRecordWhereInput = { session_id: sessionId };
    if (filter === 'flagged') {
      filterWhere = {
        session_id: sessionId,
        OR: [
          { location_flag: { in: ['mismatch', 'unverified'] } },
          { risk_score: { in: ['medium', 'high'] } },
        ],
      };
    } else if (filter === 'pending_approval') {
      filterWhere = { session_id: sessionId, approval_status: 'pending' };
    }

    const [records, total] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: filterWhere,
        skip,
        take: limit,
        orderBy: { scanned_at: 'desc' },
        include: {
          student: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.attendanceRecord.count({ where: filterWhere }),
    ]);

    // Resolve officer names for manual records
    const officerIds = [
      ...new Set(records.map((r) => r.marked_by_officer_id).filter(Boolean) as string[]),
    ];
    const officers = officerIds.length
      ? await prisma.student.findMany({
          where: { id: { in: officerIds } },
          select: { id: true, name: true },
        })
      : [];
    const officerMap = new Map(officers.map((o) => [o.id, o]));

    const result = records.map((r) => ({
      id: r.id,
      student: r.student,
      method: r.method,
      approval_status: r.approval_status,
      location_flag: r.location_flag,
      risk_score: r.risk_score,
      risk_signals: r.risk_signals != null ? (r.risk_signals as unknown) : null,
      selfie_url: r.selfie_url,
      distance_from_origin_m: r.distance_from_origin_m,
      scanned_at: r.scanned_at,
      marked_by_officer: r.marked_by_officer_id
        ? (officerMap.get(r.marked_by_officer_id) ?? null)
        : null,
    }));

    res.json({
      data: result,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  },
);

// ─── GET /api/sessions/:id/records/:recordId — single record detail ───────────

sessionRecordsRouter.get(
  '/:id/records/:recordId',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = req.user!.id;
    const { id: sessionId, recordId } = req.params;

    // Verify session's room belongs to teacher
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { room: { select: { teacher_id: true, id: true, name: true, attendance_mode: true } } },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.room.teacher_id !== teacherId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        student: { select: { id: true, name: true, email: true, parent_email: true } },
      },
    });
    if (!record || record.session_id !== sessionId) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    // Resolve officer info if manual
    let officer: { id: string; name: string } | null = null;
    if (record.marked_by_officer_id) {
      const o = await prisma.student.findUnique({
        where: { id: record.marked_by_officer_id },
        select: { id: true, name: true },
      });
      officer = o ?? null;
    }

    res.json({
      id: record.id,
      session: {
        id: session.id,
        status: session.status,
        started_at: session.started_at,
        ended_at: session.ended_at,
        room: session.room,
      },
      student: record.student,
      method: record.method,
      approval_status: record.approval_status,
      selfie_url: record.selfie_url,
      // GPS
      student_lat: record.student_lat,
      student_lng: record.student_lng,
      student_accuracy: record.student_accuracy,
      gps_readings: record.gps_readings != null ? (record.gps_readings as unknown) : null,
      distance_from_origin_m: record.distance_from_origin_m,
      location_flag: record.location_flag,
      // Risk
      risk_score: record.risk_score,
      risk_signals: record.risk_signals != null ? (record.risk_signals as unknown) : null,
      device_fingerprint: record.device_fingerprint,
      ip_address: record.ip_address,
      scanned_at: record.scanned_at,
      marked_by_officer: officer,
    });
  },
);

// ─── PATCH /api/sessions/:id/records/:recordId/approve — approve/reject ──────

sessionRecordsRouter.patch(
  '/:id/records/:recordId/approve',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = req.user!.id;
    const { id: sessionId, recordId } = req.params;
    const decision = req.body?.decision as string | undefined;

    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
      return;
    }

    // Verify session's room belongs to teacher
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

    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    if (!record || record.session_id !== sessionId) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: { approval_status: decision },
    });

    res.json({ id: updated.id, approval_status: updated.approval_status });
  },
);

// ─── GET /api/rooms/:id/sessions/:sessionId/export — CSV export ───────────────

roomSessionsRouter.get(
  '/sessions/:sessionId/export',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = req.user!.id;
    const roomId = (req.params as { id: string }).id;
    const { sessionId } = req.params;

    // Verify room belongs to teacher
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    if (room.teacher_id !== teacherId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Verify session belongs to this room
    const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
    if (!session || session.room_id !== roomId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const records = await prisma.attendanceRecord.findMany({
      where: { session_id: sessionId },
      orderBy: { scanned_at: 'asc' },
      include: {
        student: { select: { name: true, email: true } },
      },
    });

    // Build CSV manually — no extra library
    const header = 'student_name,student_email,method,approval_status,location_flag,risk_score,scanned_at';
    const escapeCell = (val: string | null | undefined): string => {
      const s = val ?? '';
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = records.map((r) =>
      [
        escapeCell(r.student.name),
        escapeCell(r.student.email),
        escapeCell(r.method),
        escapeCell(r.approval_status),
        escapeCell(r.location_flag),
        escapeCell(r.risk_score),
        escapeCell(r.scanned_at.toISOString()),
      ].join(','),
    );

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${sessionId}.csv"`);
    res.send(csv);
  },
);

export { roomSessionsRouter, sessionRecordsRouter };
export default router;
