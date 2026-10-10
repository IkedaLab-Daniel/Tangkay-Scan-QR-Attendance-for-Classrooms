import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import redis from '../lib/redis';
import { emailQueue } from '../lib/queue';
import { requireAuth } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const requestLinkSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  inviteCode: z.string().min(1),
});

const verifyCodeSchema = z.object({
  joinCode: z.string().length(6),
  inviteCode: z.string().min(1),
});

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

const ACCESS_TTL_MS = 15 * 60 * 1000;        // 15 minutes
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAGIC_LINK_TTL_SECS = 15 * 60;          // 15 minutes (Redis TTL)
const MAGIC_LINK_TTL_MS = MAGIC_LINK_TTL_SECS * 1000;

const RATE_LIMIT = 5;
const RATE_WINDOW_SECS = 15 * 60; // 15 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function issueStudentAccessToken(studentId: string): string {
  return jwt.sign(
    { typ: 'student' },
    process.env.JWT_SECRET as string,
    { subject: studentId, expiresIn: '15m' },
  );
}

function issueStudentRefreshToken(studentId: string): string {
  return jwt.sign(
    { typ: 'student' },
    process.env.JWT_REFRESH_SECRET as string,
    { subject: studentId, expiresIn: '7d' },
  );
}

function setStudentCookies(res: Response, accessToken: string, refreshToken: string): void {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: ACCESS_TTL_MS,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: REFRESH_TTL_MS,
    path: '/api/auth/student/refresh',
  });
}

function clearStudentCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth/student/refresh' });
}

async function storeStudentRefreshToken(studentId: string, token: string): Promise<void> {
  await prisma.refreshToken.create({
    data: {
      student_id: studentId,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
}

async function authenticateStudent(
  res: Response,
  student: { id: string },
): Promise<void> {
  const accessToken = issueStudentAccessToken(student.id);
  const refreshToken = issueStudentRefreshToken(student.id);
  await storeStudentRefreshToken(student.id, refreshToken);
  setStudentCookies(res, accessToken, refreshToken);
}

async function checkRateLimit(key: string): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_WINDOW_SECS);
  }
  return count > RATE_LIMIT;
}

// ─── POST /api/auth/student/request-link ──────────────────────────────────────

router.post('/request-link', async (req: Request, res: Response): Promise<void> => {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown';

  const rateLimited = await checkRateLimit(`rl:request-link:${ip}`);
  if (rateLimited) {
    res.status(429).json({ error: 'Too many requests. Try again in 15 minutes.' });
    return;
  }

  const parsed = requestLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { name, email, inviteCode } = parsed.data;

  // Verify inviteCode resolves to a real room
  const room = await prisma.room.findUnique({ where: { invite_code: inviteCode } });
  if (!room) {
    res.status(404).json({ error: 'Invalid invite code' });
    return;
  }

  // Generate plaintext token, store SHA-256 hash in Redis
  const token = crypto.randomBytes(32).toString('hex');
  const redisKey = `magic:${token}`;
  await redis.set(
    redisKey,
    JSON.stringify({ email, name, inviteCode }),
    'EX',
    MAGIC_LINK_TTL_SECS,
  );

  // Enqueue magic-link email (worker handles actual delivery)
  const magicUrl = `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/join/verify?token=${token}`;
  await emailQueue.add('magic-link', {
    type: 'magic-link',
    to: email,
    subject: 'Your TangkayScan login link',
    html: `<p>Hi ${name},</p><p>Click <a href="${magicUrl}">here</a> to join the room. This link expires in 15 minutes.</p>`,
  });

  res.json({ message: 'Check your email' });
});

// ─── GET /api/auth/student/verify/:token ──────────────────────────────────────

router.get('/verify/:token', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  const redisKey = `magic:${token}`;

  const raw = await redis.get(redisKey);
  if (!raw) {
    res.status(400).json({ error: 'Invalid or expired magic link' });
    return;
  }

  let payload: { email: string; name: string; inviteCode: string };
  try {
    payload = JSON.parse(raw) as { email: string; name: string; inviteCode: string };
  } catch {
    res.status(400).json({ error: 'Malformed magic link payload' });
    return;
  }

  const { email, name } = payload;

  // Find or create student by email
  let student = await prisma.student.findFirst({ where: { email } });
  if (!student) {
    student = await prisma.student.create({ data: { name, email } });
  }

  // Delete redis key (one-time use)
  await redis.del(redisKey);

  await authenticateStudent(res, student);
  res.json({ student: { id: student.id, name: student.name, email: student.email } });
});

// ─── POST /api/auth/student/verify-code ───────────────────────────────────────

router.post('/verify-code', async (req: Request, res: Response): Promise<void> => {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown';

  const rateLimited = await checkRateLimit(`rl:verify-code:${ip}`);
  if (rateLimited) {
    res.status(429).json({ error: 'Too many requests. Try again in 15 minutes.' });
    return;
  }

  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { joinCode, inviteCode } = parsed.data;

  // Verify invite code resolves to a room
  const room = await prisma.room.findUnique({ where: { invite_code: inviteCode } });
  if (!room) {
    res.status(404).json({ error: 'Invalid invite code' });
    return;
  }

  // Look up student by join_code hash
  const codeHash = sha256(joinCode);
  const student = await prisma.student.findUnique({ where: { join_code: codeHash } });

  if (!student) {
    res.status(401).json({ error: 'Invalid join code' });
    return;
  }

  // Check expiry (stored in magic_link_expires_at for join codes too)
  if (!student.magic_link_expires_at || student.magic_link_expires_at < new Date()) {
    res.status(401).json({ error: 'Join code expired' });
    return;
  }

  // Invalidate the code (one-time use)
  await prisma.student.update({
    where: { id: student.id },
    data: { join_code: null, magic_link_expires_at: null },
  });

  await authenticateStudent(res, student);
  res.json({ student: { id: student.id, name: student.name, email: student.email } });
});

// ─── GET /api/auth/student/me ─────────────────────────────────────────────────

router.get('/me', requireAuth('student'), async (req: Request, res: Response): Promise<void> => {
  const student = await prisma.student.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      name: true,
      email: true,
      parent_email: true,
      consent_status: true,
      created_at: true,
    },
  });

  if (!student) {
    res.status(404).json({ error: 'Student not found' });
    return;
  }

  res.json(student);
});

// ─── POST /api/auth/student/refresh ───────────────────────────────────────────

router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'No refresh token' });
    return;
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET as string) as jwt.JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  if ((payload as { typ?: string }).typ !== 'student') {
    res.status(401).json({ error: 'Invalid token type' });
    return;
  }

  const tokenHash = sha256(token);
  const stored = await prisma.refreshToken.findUnique({ where: { token_hash: tokenHash } });
  if (!stored || stored.expires_at < new Date()) {
    res.status(401).json({ error: 'Refresh token not found or expired' });
    return;
  }

  const studentId = payload.sub as string;
  const newAccessToken = issueStudentAccessToken(studentId);

  const secure = process.env.NODE_ENV === 'production';
  res.cookie(ACCESS_COOKIE, newAccessToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: ACCESS_TTL_MS,
  });

  res.json({ ok: true });
});

// ─── POST /api/auth/student/logout ────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    const tokenHash = sha256(token);
    await prisma.refreshToken.deleteMany({ where: { token_hash: tokenHash } });
  }
  clearStudentCookies(res);
  res.json({ ok: true });
});

// ─── Exported helper: resolve invite code (used by rooms router) ──────────────

export { prisma as studentAuthPrisma };

export default router;
