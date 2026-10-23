import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import redis from '../lib/redis';
import { requireAuth } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

const ACCESS_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function issueAccessToken(teacherId: string): string {
  return jwt.sign(
    { typ: 'teacher' },
    process.env.JWT_SECRET as string,
    { subject: teacherId, expiresIn: '15m' },
  );
}

function issueRefreshToken(teacherId: string): string {
  return jwt.sign(
    { typ: 'teacher', jti: crypto.randomBytes(16).toString('hex') },
    process.env.JWT_REFRESH_SECRET as string,
    { subject: teacherId, expiresIn: '7d' },
  );
}

function setCookies(res: Response, accessToken: string, refreshToken: string): void {
  const prod = (process.env.WEB_ORIGIN ?? '').startsWith('https://');
  const sameSite = prod ? 'none' : 'lax';
  const secure = prod;
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: ACCESS_TTL_MS,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: REFRESH_TTL_MS,
    path: '/api/auth/teacher/refresh',
  });
}

function clearCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth/teacher/refresh' });
}

async function storeRefreshToken(teacherId: string, token: string): Promise<void> {
  await prisma.refreshToken.create({
    data: {
      teacher_id: teacherId,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
}

// ─── Rate limiter (Redis INCR/EXPIRE) ─────────────────────────────────────────

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_SECS = 15 * 60; // 15 minutes

async function checkLoginRateLimit(ip: string, email: string): Promise<boolean> {
  const key = `login:${ip}:${email}`;
  const count = await redis.incr(key);
  if (count === 1) {
    // First attempt — set expiry window
    await redis.expire(key, LOGIN_WINDOW_SECS);
  }
  return count > LOGIN_LIMIT;
}

// ─── POST /api/auth/teacher/signup ────────────────────────────────────────────

router.post('/teacher/signup', async (req: Request, res: Response): Promise<void> => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.teacher.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  const teacher = await prisma.teacher.create({
    data: { name, email, password_hash },
  });

  const accessToken = issueAccessToken(teacher.id);
  const refreshToken = issueRefreshToken(teacher.id);
  await storeRefreshToken(teacher.id, refreshToken);

  setCookies(res, accessToken, refreshToken);
  res.status(201).json({ id: teacher.id, name: teacher.name, email: teacher.email });
});

// ─── POST /api/auth/teacher/login ─────────────────────────────────────────────

router.post('/teacher/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';

  const rateLimited = await checkLoginRateLimit(ip, email);
  if (rateLimited) {
    res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    return;
  }

  const teacher = await prisma.teacher.findUnique({ where: { email } });
  if (!teacher) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, teacher.password_hash);
  if (!passwordMatch) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const accessToken = issueAccessToken(teacher.id);
  const refreshToken = issueRefreshToken(teacher.id);
  await storeRefreshToken(teacher.id, refreshToken);

  setCookies(res, accessToken, refreshToken);
  res.json({ id: teacher.id, name: teacher.name, email: teacher.email });
});

// ─── POST /api/auth/teacher/refresh ───────────────────────────────────────────

router.post('/teacher/refresh', async (req: Request, res: Response): Promise<void> => {
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

  const tokenHash = sha256(token);
  const stored = await prisma.refreshToken.findUnique({ where: { token_hash: tokenHash } });
  if (!stored || stored.expires_at < new Date()) {
    res.status(401).json({ error: 'Refresh token not found or expired' });
    return;
  }

  const teacherId = payload.sub as string;
  const newAccessToken = issueAccessToken(teacherId);

  const prod = (process.env.WEB_ORIGIN ?? '').startsWith('https://');
  res.cookie(ACCESS_COOKIE, newAccessToken, {
    httpOnly: true,
    sameSite: prod ? 'none' : 'lax',
    secure: prod,
    maxAge: ACCESS_TTL_MS,
  });

  res.json({ ok: true });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    const tokenHash = sha256(token);
    await prisma.refreshToken.deleteMany({ where: { token_hash: tokenHash } });
  }
  clearCookies(res);
  res.json({ ok: true });
});

// ─── GET /api/auth/me — works for both teacher and student ────────────────────

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const token: string | undefined = req.cookies?.access_token;
  if (!token) { res.status(401).json({ error: 'No access token' }); return; }

  let payload: { sub: string; typ: string };
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as { sub: string; typ: string };
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' }); return;
  }

  if (payload.typ === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, plan: true, created_at: true },
    });
    if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
    res.json({ ...teacher, typ: 'teacher' });
    return;
  }

  if (payload.typ === 'student') {
    const student = await prisma.student.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, parent_email: true, consent_status: true },
    });
    if (!student) { res.status(404).json({ error: 'Student not found' }); return; }
    res.json({ ...student, typ: 'student' });
    return;
  }

  res.status(403).json({ error: 'Unknown token type' });
});

// ─── GET /api/auth/token — return raw access token for SSE bypass ─────────────
// SSE connections can't go through the Next.js proxy (it buffers streams), so
// the client fetches this token via the proxy then opens EventSource directly
// to Render with ?token= to avoid buffering.

router.get('/token', (req: Request, res: Response): void => {
  const token: string | undefined = req.cookies?.access_token;
  if (!token) { res.status(401).json({ error: 'No access token' }); return; }
  // Validate it's a legitimate token before handing it out
  try {
    jwt.verify(token, process.env.JWT_SECRET as string);
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' }); return;
  }
  res.json({ token });
});

export default router;
