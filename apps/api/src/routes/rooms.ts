import { Router, Request, Response } from 'express';
import { customAlphabet } from 'nanoid';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { getModePreset } from '../lib/modePresets';
import joinRouter from './join';
import officersRouter from './officers';

const router = Router();
const prisma = new PrismaClient();

// URL-safe alphabet (A-Z a-z 0-9 _ -)
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', 8);

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const attendanceModeEnum = z.enum(['strict', 'balanced', 'static', 'manual']);
const gpsPolicyEnum = z.enum(['off', 'warn', 'reject']);
const selfiePolicyEnum = z.enum(['off', 'optional', 'required']);

const createRoomSchema = z.object({
  name: z.string().min(2).max(100),
  attendance_mode: attendanceModeEnum,
  geofence_radius_m: z.number().int().min(10).max(2000).optional(),
  gps_policy: gpsPolicyEnum.optional(),
  selfie_policy: selfiePolicyEnum.optional(),
  require_manual_approval: z.boolean().optional(),
  anchor_lat: z.number().min(-90).max(90).optional(),
  anchor_lng: z.number().min(-180).max(180).optional(),
});

const patchRoomSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  attendance_mode: attendanceModeEnum.optional(),
  geofence_radius_m: z.number().int().min(10).max(2000).optional(),
  gps_policy: gpsPolicyEnum.optional(),
  selfie_policy: selfiePolicyEnum.optional(),
  require_manual_approval: z.boolean().optional(),
  anchor_lat: z.number().min(-90).max(90).optional(),
  anchor_lng: z.number().min(-180).max(180).optional(),
  background_type: z.enum(['none', 'preset', 'custom']).optional(),
  background_preset_id: z.string().optional(),
  background_image_path: z.string().optional(),
  background_placeholder: z.string().optional(),
  background_dim: z.number().int().min(0).max(100).optional(),
  background_blur: z.number().int().min(0).max(100).optional(),
  background_scrim: z.enum(['light', 'dark']).optional(),
});

// ─── GET /api/rooms/join/:inviteCode — public ─────────────────────────────────

router.get('/join/:inviteCode', async (req: Request, res: Response): Promise<void> => {
  const room = await prisma.room.findUnique({
    where: { invite_code: req.params.inviteCode },
    select: {
      id: true,
      name: true,
      teacher: { select: { name: true } },
    },
  });

  if (!room) {
    res.status(404).json({ error: 'Invalid invite code' });
    return;
  }

  res.json({
    roomId: room.id,
    roomName: room.name,
    teacherName: room.teacher.name,
  });
});

// ─── POST /api/rooms ──────────────────────────────────────────────────────────

router.post('/', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const {
    name,
    attendance_mode,
    geofence_radius_m,
    gps_policy,
    selfie_policy,
    require_manual_approval,
    anchor_lat,
    anchor_lng,
  } = parsed.data;

  const preset = getModePreset(attendance_mode);
  const invite_code = nanoid();

  const room = await prisma.room.create({
    data: {
      teacher_id: req.user!.id,
      name,
      invite_code,
      attendance_mode,
      qr_type: preset.qr_type,
      gps_policy: gps_policy ?? preset.gps_policy,
      selfie_policy: selfie_policy ?? preset.selfie_policy,
      geofence_radius_m: geofence_radius_m ?? 100,
      require_manual_approval: require_manual_approval ?? true,
      anchor_lat,
      anchor_lng,
    },
  });

  res.status(201).json(room);
});

// ─── GET /api/rooms ───────────────────────────────────────────────────────────

router.get('/', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const rooms = await prisma.room.findMany({
    where: { teacher_id: req.user!.id },
    orderBy: { created_at: 'desc' },
  });
  res.json(rooms);
});

// ─── GET /api/rooms/:id ───────────────────────────────────────────────────────

router.get('/:id', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });

  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (room.teacher_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  res.json(room);
});

// ─── PATCH /api/rooms/:id ─────────────────────────────────────────────────────

router.patch('/:id', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const parsed = patchRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.room.findUnique({ where: { id: req.params.id } });

  if (!existing) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (existing.teacher_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { attendance_mode, gps_policy, selfie_policy, ...rest } = parsed.data;

  // Re-apply preset when mode changes, but explicit overrides in the same request win
  let modeFields: {
    attendance_mode?: typeof attendance_mode;
    qr_type?: ReturnType<typeof getModePreset>['qr_type'];
    gps_policy?: ReturnType<typeof getModePreset>['gps_policy'];
    selfie_policy?: ReturnType<typeof getModePreset>['selfie_policy'];
  } = {};

  if (attendance_mode !== undefined) {
    const preset = getModePreset(attendance_mode);
    modeFields = {
      attendance_mode,
      qr_type: preset.qr_type,
      gps_policy: gps_policy ?? preset.gps_policy,
      selfie_policy: selfie_policy ?? preset.selfie_policy,
    };
  } else {
    // No mode change — honour explicit overrides as-is
    if (gps_policy !== undefined) modeFields.gps_policy = gps_policy;
    if (selfie_policy !== undefined) modeFields.selfie_policy = selfie_policy;
  }

  const updated = await prisma.room.update({
    where: { id: req.params.id },
    data: { ...rest, ...modeFields },
  });

  res.json(updated);
});

// ─── POST /api/rooms/:id/join-codes — teacher generates a code for a student ──

router.post('/:id/join-codes', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const joinCodeSchema = z.object({
    studentName: z.string().min(2),
    parentEmail: z.string().email().optional(),
  });

  const parsed = joinCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  if (room.teacher_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { studentName, parentEmail } = parsed.data;

  // Generate 6-digit numeric code (plaintext shown once to teacher)
  const plainCode = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = sha256(plainCode);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  // Find-or-create student by parentEmail or name
  let student = parentEmail
    ? await prisma.student.findFirst({ where: { parent_email: parentEmail } })
    : null;

  if (student) {
    // Update existing student with new code
    student = await prisma.student.update({
      where: { id: student.id },
      data: {
        name: studentName,
        join_code: codeHash,
        magic_link_expires_at: expiresAt,
      },
    });
  } else {
    // Try to create; handle unique constraint collision on join_code
    student = await prisma.student.create({
      data: {
        name: studentName,
        parent_email: parentEmail,
        join_code: codeHash,
        magic_link_expires_at: expiresAt,
      },
    });
  }

  res.status(201).json({ joinCode: plainCode, studentId: student.id, expiresAt });
});

// ─── GET /api/rooms/:id/members ───────────────────────────────────────────────

router.get('/:id/members', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });

  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (room.teacher_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const members = await prisma.roomMember.findMany({
    where: { room_id: req.params.id },
    include: { student: { select: { id: true, name: true, email: true } } },
    orderBy: [
      // 'officer' has higher enum index than 'student', so desc puts officers first
      { role: 'desc' },
      { student: { name: 'asc' } },
    ],
  });

  res.json(members);
});

// ─── Mount sub-routers ────────────────────────────────────────────────────────

router.use('/:id/officers', officersRouter);
router.use('/:id/join', joinRouter);

export default router;
