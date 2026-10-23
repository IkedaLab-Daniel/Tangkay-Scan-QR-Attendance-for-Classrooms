import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import * as tokenRotator from '../lib/tokenRotator';
import * as sseManager from '../lib/sseManager';

const router = Router();
const prisma = new PrismaClient();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const startSessionSchema = z.object({
  roomId: z.string().min(1),
  originLat: z.number().min(-90).max(90).optional(),
  originLng: z.number().min(-180).max(180).optional(),
  originAccuracy: z.number().optional(),
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────

// We implement the combined auth check directly in each handler via a helper:
async function resolveUser(
  req: Request,
  res: Response,
): Promise<{ id: string; typ: string } | null> {
  // Cookie first; fall back to ?token= query param (used by SSE to bypass Next.js proxy buffering)
  const token: string | undefined =
    req.cookies?.access_token ?? (req.query.token as string | undefined);
  if (!token) {
    res.status(401).json({ error: 'No access token' });
    return null;
  }

  let jwt: { sub: string; typ: string };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jsonwebtoken = require('jsonwebtoken') as typeof import('jsonwebtoken');
    jwt = jsonwebtoken.verify(token, process.env.JWT_SECRET as string) as {
      sub: string;
      typ: string;
    };
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' });
    return null;
  }

  if (jwt.typ !== 'teacher' && jwt.typ !== 'student') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  req.user = { id: jwt.sub, typ: jwt.typ };
  return req.user;
}

// ─── GET /api/sessions/recent?limit=N — teacher-auth ────────────────────────

router.get('/recent', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const rooms = await prisma.room.findMany({
    where: { teacher_id: req.user!.id },
    select: { id: true },
  });
  const roomIds = rooms.map((r) => r.id);

  const sessions = await prisma.attendanceSession.findMany({
    where: { room_id: { in: roomIds } },
    include: {
      room: { select: { id: true, name: true, attendance_mode: true } },
      records: {
        select: { approval_status: true, location_flag: true, risk_score: true },
      },
    },
    orderBy: { started_at: 'desc' },
    take: limit,
  });

  const result = sessions.map((s) => {
    const presentCount = s.records.filter((r) => r.approval_status === 'approved').length;
    const flaggedCount = s.records.filter(
      (r) => r.location_flag === 'mismatch' || r.risk_score === 'high' || r.risk_score === 'medium',
    ).length;
    const pendingCount = s.records.filter((r) => r.approval_status === 'pending').length;
    return {
      id: s.id,
      room: s.room,
      status: s.status,
      started_at: s.started_at,
      ended_at: s.ended_at,
      presentCount,
      flaggedCount,
      pendingCount,
    };
  });

  res.json(result);
});

// ─── GET /api/sessions/active?roomId=xxx — student-auth ─────────────────────

router.get('/active', requireAuth('student'), async (req: Request, res: Response): Promise<void> => {
  const { roomId } = req.query;
  if (!roomId || typeof roomId !== 'string') {
    res.status(400).json({ error: 'roomId query param required' });
    return;
  }
  const session = await prisma.attendanceSession.findFirst({
    where: { room_id: roomId, status: 'active' },
  });
  if (!session) {
    res.status(404).json({ message: 'No active session' });
    return;
  }
  res.json(session);
});


// ─── POST /api/sessions ───────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const user = await resolveUser(req, res);
  if (!user) return;

  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { roomId, originLat, originLng, originAccuracy } = parsed.data;

  // Verify the room exists and belongs to the requesting teacher (or is accessible by officer)
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (user.typ === 'teacher' && room.teacher_id !== user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (user.typ === 'student') {
    // Must be an officer of this room
    const member = await prisma.roomMember.findFirst({
      where: { student_id: user.id, room_id: roomId, role: 'officer' },
    });
    if (!member) {
      res.status(403).json({ error: 'Forbidden: officer role required' });
      return;
    }
  }

  // Only one active session per room
  const existing = await prisma.attendanceSession.findFirst({
    where: { room_id: roomId, status: 'active' },
  });
  if (existing) {
    res.status(409).json({ error: 'Room already has an active session', sessionId: existing.id });
    return;
  }

  const session = await prisma.attendanceSession.create({
    data: {
      room_id: roomId,
      started_by_officer_id: user.typ === 'student' ? user.id : null,
      origin_lat: originLat,
      origin_lng: originLng,
      origin_accuracy: originAccuracy,
      status: 'active',
    },
  });

  const token = await tokenRotator.startRotation(session.id);
  const expiresAt = new Date(Date.now() + 30_000).toISOString();

  res.status(201).json({ ...session, token, expiresAt });
});

// ─── POST /api/sessions/:id/end ───────────────────────────────────────────────

router.post('/:id/end', async (req: Request, res: Response): Promise<void> => {
  const user = await resolveUser(req, res);
  if (!user) return;

  const session = await prisma.attendanceSession.findUnique({
    where: { id: req.params.id },
    include: { room: { select: { teacher_id: true } } },
  });

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (session.status === 'ended') {
    res.status(409).json({ error: 'Session already ended' });
    return;
  }

  // Authorization: teacher who owns the room OR the officer who started it
  const isRoomTeacher = user.typ === 'teacher' && session.room.teacher_id === user.id;
  const isStartingOfficer =
    user.typ === 'student' && session.started_by_officer_id === user.id;

  if (!isRoomTeacher && !isStartingOfficer) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const updated = await prisma.attendanceSession.update({
    where: { id: req.params.id },
    data: { status: 'ended', ended_at: new Date() },
  });

  tokenRotator.stopRotation(req.params.id);
  sseManager.cleanup(req.params.id);

  res.json(updated);
});

// ─── GET /api/sessions/:id/stream ─────────────────────────────────────────────

router.get('/:id/stream', async (req: Request, res: Response): Promise<void> => {
  const user = await resolveUser(req, res);
  if (!user) return;

  const session = await prisma.attendanceSession.findUnique({
    where: { id: req.params.id },
    include: { room: { select: { teacher_id: true } } },
  });

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Teacher who owns the room OR any student (officer) in the room
  if (user.typ === 'teacher' && session.room.teacher_id !== user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Subscribe — this keeps the response open (no res.end/res.json)
  sseManager.subscribe(req.params.id, res);

  // Send the current token immediately as the first event
  const currentToken = await tokenRotator.getCurrentToken(req.params.id);
  if (currentToken) {
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    res.write(`data: ${JSON.stringify({ token: currentToken, expiresAt })}\n\n`);
  }
});

// ─── GET /api/sessions/:id — teacher owner OR student officer who started it ──

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const user = await resolveUser(req, res);
  if (!user) return;

  const session = await prisma.attendanceSession.findUnique({
    where: { id: req.params.id },
    include: {
      room: { select: { teacher_id: true } },
      records: { select: { approval_status: true } },
    },
  });

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (user.typ === 'teacher' && session.room.teacher_id !== user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (user.typ === 'student') {
    // Must be the officer who started the session OR an officer of the room
    const isOfficer = await prisma.roomMember.findFirst({
      where: { student_id: user.id, room_id: session.room_id, role: 'officer' },
    });
    if (!isOfficer) {
      res.status(403).json({ error: 'Forbidden: officer role required' });
      return;
    }
  }

  const presentCount = session.records.filter((r) => r.approval_status === 'approved').length;
  res.json({ ...session, present_count: presentCount });
});

// ─── POST /api/rooms/:id/static-session/open ─────────────────────────────────

const sessionsRoomRouter = Router({ mergeParams: true });

sessionsRoomRouter.post('/static-session/open', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const roomId = (req.params as { id: string }).id;

  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (room.teacher_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // 409 if room already has an active session
  const existing = await prisma.attendanceSession.findFirst({
    where: { room_id: roomId, status: 'active' },
  });
  if (existing) {
    res.status(409).json({ error: 'Room already has an active session', sessionId: existing.id });
    return;
  }

  const session = await prisma.attendanceSession.create({
    data: {
      room_id: roomId,
      started_by_officer_id: null,
      origin_lat: room.anchor_lat,
      origin_lng: room.anchor_lng,
      origin_accuracy: 0,
      status: 'active',
    },
  });

  res.status(201).json(session);
});

// ─── POST /api/rooms/:id/static-session/close ────────────────────────────────

sessionsRoomRouter.post('/static-session/close', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const roomId = (req.params as { id: string }).id;

  const room = await prisma.room.findUnique({ where: { id: roomId } });

  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (room.teacher_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const session = await prisma.attendanceSession.findFirst({
    where: { room_id: roomId, status: 'active' },
  });

  if (!session) {
    res.status(404).json({ error: 'No active session found for this room' });
    return;
  }

  const updated = await prisma.attendanceSession.update({
    where: { id: session.id },
    data: { status: 'ended', ended_at: new Date() },
  });

  res.json(updated);
});

export { sessionsRoomRouter };
export default router;
