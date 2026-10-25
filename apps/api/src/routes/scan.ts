import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import redis from '../lib/redis';
import { runPipeline, ScanPayload } from '../lib/scanPipeline';
import { pickRepresentativeReading } from '../lib/geo';
import { parentQueue } from '../lib/queue';
import { validateImageSignature, processImage } from '../lib/imageProcessor';
import { prisma } from '../lib/prisma';

const router = Router();

// ─── Upload directory ─────────────────────────────────────────────────────────

const SELFIE_DIR = path.join(process.cwd(), 'uploads', 'selfies');

function ensureSelfieDir(): void {
  if (!fs.existsSync(SELFIE_DIR)) {
    fs.mkdirSync(SELFIE_DIR, { recursive: true });
  }
}

// ─── Multer config — memory storage ──────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB raw max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});

// ─── Zod schema ───────────────────────────────────────────────────────────────

const readingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().positive(),
  altitude: z.number().nullable(),
  speed: z.number().nullable(),
  heading: z.number().nullable(),
  timestamp: z.number().int().positive(),
});

const scanPayloadSchema = z
  .object({
    token: z.string().min(1),
    readings: z.array(readingSchema).max(10),
    client_time: z.number().int().positive(),
    device_fingerprint: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (data.readings.length < 2) return; // 0 or 1 reading — no spread to check
    const timestamps = data.readings.map((r) => r.timestamp);
    const spread = Math.max(...timestamps) - Math.min(...timestamps);
    if (spread > 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Timestamp spread across readings exceeds 10 000 ms',
        path: ['readings'],
      });
    }
  });

// ─── Payload normalizer — supports both JSON and multipart ───────────────────

function normalizeBody(req: Request): Record<string, unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('multipart/form-data')) {
    // All fields arrive as strings from multipart — coerce the ones we need
    const body = req.body as Record<string, string>;
    return {
      token: body.token,
      readings: body.readings ? (JSON.parse(body.readings) as unknown) : [],
      client_time: body.client_time ? Number(body.client_time) : undefined,
      device_fingerprint: body.device_fingerprint,
    };
  }
  return req.body as Record<string, unknown>;
}

// ─── POST /api/sessions/:id/scan ──────────────────────────────────────────────

router.post(
  '/:id/scan',
  requireAuth('student'),
  upload.single('selfie'),
  async (req: Request, res: Response): Promise<void> => {
    const studentId = req.user!.id;
    const sessionId = req.params.id;

    // 1. Validate payload
    const parsed = scanPayloadSchema.safeParse(normalizeBody(req));
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const payload = parsed.data as ScanPayload;

    // 2. Rate-limit: 5s window per student+session
    const rateKey = `scan_rate:${sessionId}:${studentId}`;
    const rateHit = await redis.get(rateKey);
    if (rateHit) {
      res.status(429).json({ error: 'Too many requests — wait 5 s before retrying' });
      return;
    }

    // 3. Load session with room
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { room: true },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // 4. Load student + membership in the session's room
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    const member = await prisma.roomMember.findUnique({
      where: {
        room_id_student_id: {
          room_id: session.room_id,
          student_id: studentId,
        },
      },
    });
    if (!member) {
      res.status(403).json({ error: 'Not a member of this room' });
      return;
    }

    // 5. Selfie-policy enforcement (pre-pipeline)
    const selfiePolicy = session.room.selfie_policy; // 'off' | 'optional' | 'required'
    const selfieFile = req.file;

    if (selfiePolicy === 'required' && !selfieFile) {
      res.status(400).json({ status: 'rejected', reason: 'selfie_required' });
      return;
    }

    // 6. Build pipeline context
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      '';

    const ctx = {
      payload,
      session,
      student: { ...student, member },
      ipAddress,
    };

    // 7. Run pipeline
    const result = await runPipeline(ctx, prisma);

    // 8. Idempotent already_recorded
    if (!result.pass && result.reason === 'already_recorded') {
      res.status(200).json({ status: 'already_recorded' });
      return;
    }

    // 9. Rejected
    if (!result.pass) {
      res.status(400).json({ status: 'rejected', reason: result.reason });
      return;
    }

    // 10. Persist attendance record
    const rep = pickRepresentativeReading(payload.readings);

    const record = await prisma.attendanceRecord.create({
      data: {
        session_id: sessionId,
        student_id: studentId,
        method: 'qr_scan',
        approval_status: 'approved',
        gps_readings: payload.readings as unknown as Prisma.InputJsonValue,
        student_lat: rep?.lat ?? null,
        student_lng: rep?.lng ?? null,
        student_accuracy: rep?.accuracy ?? null,
        distance_from_origin_m: result.distanceM ?? null,
        location_flag: result.locationFlag ?? null,
        risk_score: result.riskScore,
        risk_signals: result.riskSignals,
        device_fingerprint: payload.device_fingerprint,
        ip_address:
          (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
          req.socket.remoteAddress ??
          null,
        selfie_url: null, // set below if selfie is processed
      },
    });

    // 11. Process + save selfie (if provided and policy is not 'off')
    if (selfieFile && selfiePolicy !== 'off') {
      try {
        const imgType = validateImageSignature(selfieFile.buffer);
        if (!imgType) {
          // Non-fatal — record is already created; log and skip
          console.warn(`[scan] Invalid selfie image signature for record ${record.id}`);
        } else {
          const processed = await processImage(selfieFile.buffer, {
            maxLongEdgePx: 1600,
            quality: 80,
          });

          ensureSelfieDir();
          const filename = `${record.id}-${Date.now()}.webp`;
          const filePath = path.join(SELFIE_DIR, filename);
          fs.writeFileSync(filePath, processed.buffer);
          const selfieUrl = `uploads/selfies/${filename}`;

          await prisma.attendanceRecord.update({
            where: { id: record.id },
            data: { selfie_url: selfieUrl },
          });

          record.selfie_url = selfieUrl;
        }
      } catch (err) {
        // Non-fatal — record is valid without selfie
        console.error(`[scan] Failed to save selfie for record ${record.id}:`, err);
      }
    }

    // 12. Set scan-rate key after successful persist (guards rapid duplicates)
    await redis.set(rateKey, '1', 'EX', 5);

    // 13. Enqueue parent notification stub (processed in Sub-Task 9)
    parentQueue.add('parent-notification', { recordId: record.id }).catch(() => {});

    // 14. Return
    const status = result.flag ? 'flagged' : 'recorded';
    res.status(200).json({ status, record_id: record.id, selfie_url: record.selfie_url });
  },
);

export default router;
