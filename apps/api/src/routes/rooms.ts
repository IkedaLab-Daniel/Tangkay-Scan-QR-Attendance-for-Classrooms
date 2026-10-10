import { Router, Request, Response } from 'express';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { getModePreset } from '../lib/modePresets';

const router = Router();
const prisma = new PrismaClient();

// URL-safe alphabet (A-Z a-z 0-9 _ -)
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', 8);

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

export default router;
