import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import {
  validateImageSignature,
  processImage,
  computeLuminanceScrim,
  generatePlaceholder,
} from '../lib/imageProcessor';

const router = Router({ mergeParams: true });
const prisma = new PrismaClient();

// ─── Directories ──────────────────────────────────────────────────────────────

const BG_DIR = path.join(process.cwd(), 'uploads', 'backgrounds');
const PRESET_DIR = path.join(process.cwd(), 'assets', 'presets');

function ensureBgDir(): void {
  if (!fs.existsSync(BG_DIR)) {
    fs.mkdirSync(BG_DIR, { recursive: true });
  }
}

// ─── Multer — memory storage, 5 MB cap ───────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ─── Preset list (module-level constant — used by GET /api/presets too) ───────

export const PRESETS: Array<{ id: string; name: string }> = [
  { id: 'paper',  name: 'Paper'  },
  { id: 'sprout', name: 'Sprout' },
  { id: 'oat',    name: 'Oat'    },
];

// ─── Helper: load room and verify teacher ownership ───────────────────────────

async function loadRoomForTeacher(
  roomId: string,
  teacherId: string,
  res: Response,
): Promise<import('@prisma/client').Room | null> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  if (room.teacher_id !== teacherId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return room;
}

// ─── Helper: delete file from disk, silently swallow ENOENT ──────────────────

function deleteFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// ─── POST /api/rooms/:id/background — upload custom background ────────────────

router.post(
  '/background',
  requireAuth('teacher'),
  upload.single('background'),
  async (req: Request, res: Response): Promise<void> => {
    const room = await loadRoomForTeacher(req.params.id, req.user!.id, res);
    if (!room) return;

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const imageType = validateImageSignature(req.file.buffer);
    if (!imageType) {
      res.status(400).json({ error: 'Invalid image type. Must be JPEG, PNG, or WebP.' });
      return;
    }

    const processed = await processImage(req.file.buffer, { maxLongEdgePx: 1600, quality: 80 });
    const scrim = await computeLuminanceScrim(processed.buffer);
    const placeholder = await generatePlaceholder(processed.buffer);

    // Delete old custom background file if present
    if (room.background_image_path) {
      deleteFile(path.join(process.cwd(), room.background_image_path));
    }

    ensureBgDir();
    const filename = `${room.id}-${Date.now()}.webp`;
    const relativePath = path.join('uploads', 'backgrounds', filename);
    const absolutePath = path.join(process.cwd(), relativePath);
    fs.writeFileSync(absolutePath, processed.buffer);

    const updated = await prisma.room.update({
      where: { id: room.id },
      data: {
        background_type: 'custom',
        background_image_path: relativePath,
        background_placeholder: placeholder,
        background_scrim: scrim,
        background_dim: 35,
      },
    });

    res.json({
      background_type: updated.background_type,
      background_image_path: updated.background_image_path,
      background_placeholder: updated.background_placeholder,
      background_scrim: updated.background_scrim,
      background_dim: updated.background_dim,
      background_blur: updated.background_blur,
      background_preset_id: updated.background_preset_id,
    });
  },
);

// ─── DELETE /api/rooms/:id/background — remove custom background ─────────────

router.delete(
  '/background',
  requireAuth('teacher'),
  async (req: Request, res: Response): Promise<void> => {
    const room = await loadRoomForTeacher(req.params.id, req.user!.id, res);
    if (!room) return;

    if (room.background_image_path) {
      deleteFile(path.join(process.cwd(), room.background_image_path));
    }

    await prisma.room.update({
      where: { id: room.id },
      data: {
        background_type: 'none',
        background_image_path: null,
        background_placeholder: null,
        background_scrim: 'dark',
        background_dim: 35,
        background_blur: 0,
        background_preset_id: null,
      },
    });

    res.json({ message: 'Background removed' });
  },
);

// ─── GET /api/rooms/:id/background-image — serve background file ─────────────
// Any authenticated user (teacher or student) who is associated with the room.
// For preset images: no auth required when ?preset=<id> is passed.

router.get(
  '/background-image',
  async (req: Request, res: Response): Promise<void> => {
    const roomId = req.params.id;

    // ── Preset branch: public, no auth ──────────────────────────────────────
    const presetQuery = req.query.preset as string | undefined;
    if (presetQuery) {
      const valid = PRESETS.some((p) => p.id === presetQuery);
      if (!valid) {
        res.status(404).json({ error: 'Preset not found' });
        return;
      }

      // Optionally verify this room uses this preset (best-effort, no auth)
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.background_type !== 'preset' || room.background_preset_id !== presetQuery) {
        res.status(404).json({ error: 'No preset background for this room' });
        return;
      }

      const presetPath = path.join(PRESET_DIR, `${presetQuery}.webp`);
      if (!fs.existsSync(presetPath)) {
        res.status(404).json({ error: 'Preset file not found' });
        return;
      }

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(presetPath);
      return;
    }

    // ── Custom background: auth required ────────────────────────────────────
    const token: string | undefined = req.cookies?.access_token;
    if (!token) {
      res.status(401).json({ error: 'No access token' });
      return;
    }

    let payload: { sub: string; typ: string };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      payload = jwt.verify(token, process.env.JWT_SECRET as string) as { sub: string; typ: string };
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }

    if (payload.typ !== 'teacher' && payload.typ !== 'student') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    if (room.background_type !== 'custom' || !room.background_image_path) {
      res.status(404).json({ error: 'No custom background for this room' });
      return;
    }

    // Authorisation: teacher owns room, OR student/officer is enrolled
    if (payload.typ === 'teacher') {
      if (room.teacher_id !== payload.sub) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    } else {
      // student or officer
      const membership = await prisma.roomMember.findUnique({
        where: { room_id_student_id: { room_id: roomId, student_id: payload.sub } },
      });
      if (!membership) {
        res.status(403).json({ error: 'Forbidden: not enrolled in this room' });
        return;
      }
    }

    const filePath = path.join(process.cwd(), room.background_image_path);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Background file not found' });
      return;
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  },
);

// ─── POST /api/rooms/:id/background/report — student/officer reports bg ──────

const reportSchema = z.object({
  reason: z.string().max(500).optional(),
});

router.post(
  '/background/report',
  async (req: Request, res: Response): Promise<void> => {
    // Accept student or officer tokens (both have typ === 'student')
    const token: string | undefined = req.cookies?.access_token;
    if (!token) {
      res.status(401).json({ error: 'No access token' });
      return;
    }

    let payload: { sub: string; typ: string };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      payload = jwt.verify(token, process.env.JWT_SECRET as string) as { sub: string; typ: string };
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }

    if (payload.typ !== 'student') {
      res.status(403).json({ error: 'Forbidden: students only' });
      return;
    }

    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const roomId = req.params.id;
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    // Verify enrolment
    const membership = await prisma.roomMember.findUnique({
      where: { room_id_student_id: { room_id: roomId, student_id: payload.sub } },
    });
    if (!membership) {
      res.status(403).json({ error: 'Forbidden: not enrolled in this room' });
      return;
    }

    await prisma.backgroundReport.create({
      data: {
        room_id: roomId,
        reported_by_student_id: payload.sub,
        reason: parsed.data.reason,
      },
    });

    res.json({ message: 'Report submitted' });
  },
);

// ─── DELETE /api/admin/rooms/:id/background — teacher admin removal ───────────
// Mounted separately in index.ts under /api/admin/rooms/:id.
// Exported so index.ts can wire it up.

export const adminDeleteBackground = async (req: Request, res: Response): Promise<void> => {
  const room = await loadRoomForTeacher(req.params.id, req.user!.id, res);
  if (!room) return;

  if (room.background_image_path) {
    deleteFile(path.join(process.cwd(), room.background_image_path));
  }

  await prisma.room.update({
    where: { id: room.id },
    data: {
      background_type: 'none',
      background_image_path: null,
      background_placeholder: null,
      background_scrim: 'dark',
      background_dim: 35,
      background_blur: 0,
      background_preset_id: null,
    },
  });

  res.json({ message: 'Background removed' });
};

export default router;
