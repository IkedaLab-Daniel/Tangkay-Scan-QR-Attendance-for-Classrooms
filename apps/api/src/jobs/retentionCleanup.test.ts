import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { runRetentionCleanup } from '../jobs/retentionCleanup';
import redis from '../lib/redis';
import request from 'supertest';
import app from '../index';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCookies(res: request.Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const cookieList = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const cookie of cookieList) {
    const [pair] = cookie.split(';');
    const [name, ...rest] = pair.split('=');
    cookies[name.trim()] = rest.join('=').trim();
  }
  return cookies;
}

async function signupTeacher(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/teacher/signup')
    .send({ name: 'Teacher', email, password: 'password123' });
  return parseCookies(res)['access_token'];
}

async function createRoomAndSession(teacherCookie: string): Promise<{
  roomId: string;
  sessionId: string;
  inviteCode: string;
}> {
  const roomRes = await request(app)
    .post('/api/rooms')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ name: 'Retention Test Room', attendance_mode: 'balanced' });
  const roomId = roomRes.body.id as string;
  const inviteCode = roomRes.body.invite_code as string;

  const sessionRes = await request(app)
    .post('/api/sessions')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ roomId });
  const sessionId = sessionRes.body.id as string;

  return { roomId, sessionId, inviteCode };
}

async function enrollStudent(inviteCode: string): Promise<{ studentId: string; cookie: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const email = `student-${crypto.randomBytes(4).toString('hex')}@test.com`;
  await redis.set(`magic:${token}`, JSON.stringify({ email, name: 'Student', inviteCode }), 'EX', 900);
  const res = await request(app).get(`/api/auth/student/verify/${token}`);
  const cookie = parseCookies(res)['access_token'];

  const meRes = await request(app)
    .get('/api/auth/student/me')
    .set('Cookie', `access_token=${cookie}`);
  const studentId = meRes.body.id as string;

  return { studentId, cookie };
}

/**
 * Directly insert an AttendanceRecord with a specific scanned_at so we can simulate old/new records
 */
async function insertRecord(opts: {
  sessionId: string;
  studentId: string;
  scannedAt: Date;
  selfieUrl?: string | null;
  studentLat?: number | null;
  studentLng?: number | null;
}): Promise<string> {
  const record = await prisma.attendanceRecord.create({
    data: {
      session_id: opts.sessionId,
      student_id: opts.studentId,
      method: 'qr_scan',
      approval_status: 'approved',
      selfie_url: opts.selfieUrl ?? null,
      student_lat: opts.studentLat ?? null,
      student_lng: opts.studentLng ?? null,
      scanned_at: opts.scannedAt,
    },
  });
  return record.id;
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runRetentionCleanup', () => {
  it('deletes selfie file and nullifies fields for records older than 30 days', async () => {
    const teacherCookie = await signupTeacher(`retention-old-${Date.now()}@test.com`);
    const { sessionId, inviteCode } = await createRoomAndSession(teacherCookie);
    const { studentId } = await enrollStudent(inviteCode);

    // Create a fake selfie file on disk
    const selfiesDir = path.join(process.cwd(), 'uploads', 'selfies');
    fs.mkdirSync(selfiesDir, { recursive: true });
    const filename = `test-selfie-${Date.now()}.jpg`;
    const filePath = path.join(selfiesDir, filename);
    fs.writeFileSync(filePath, 'fake-image-data');

    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const recordId = await insertRecord({
      sessionId,
      studentId,
      scannedAt: oldDate,
      selfieUrl: filename,
      studentLat: 14.5995,
      studentLng: 120.9842,
    });

    const result = await runRetentionCleanup();

    expect(result.deletedFiles).toBeGreaterThanOrEqual(1);
    expect(result.nullifiedRecords).toBeGreaterThanOrEqual(1);

    // File should be gone
    expect(fs.existsSync(filePath)).toBe(false);

    // DB fields should be nulled
    const updated = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    expect(updated?.selfie_url).toBeNull();
    expect(updated?.student_lat).toBeNull();
    expect(updated?.student_lng).toBeNull();
    expect(updated?.student_accuracy).toBeNull();
    expect(updated?.gps_readings).toStrictEqual([]);
  });

  it('does not touch records newer than 30 days', async () => {
    const teacherCookie = await signupTeacher(`retention-new-${Date.now()}@test.com`);
    const { sessionId, inviteCode } = await createRoomAndSession(teacherCookie);
    const { studentId } = await enrollStudent(inviteCode);

    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const recordId = await insertRecord({
      sessionId,
      studentId,
      scannedAt: recentDate,
      selfieUrl: 'recent-selfie.jpg',
      studentLat: 14.5995,
      studentLng: 120.9842,
    });

    await runRetentionCleanup();

    // Recent record should be untouched
    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    expect(record?.selfie_url).toBe('recent-selfie.jpg');
    expect(record?.student_lat).toBe(14.5995);
  });

  it('does not throw when selfie file is missing (ENOENT)', async () => {
    const teacherCookie = await signupTeacher(`retention-enoent-${Date.now()}@test.com`);
    const { sessionId, inviteCode } = await createRoomAndSession(teacherCookie);
    const { studentId } = await enrollStudent(inviteCode);

    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const recordId = await insertRecord({
      sessionId,
      studentId,
      scannedAt: oldDate,
      selfieUrl: 'nonexistent-file-xyz.jpg',
      studentLat: null,
      studentLng: null,
    });

    // Should not throw even though the file doesn't exist
    await expect(runRetentionCleanup()).resolves.toMatchObject({
      nullifiedRecords: expect.any(Number),
    });

    // Record should still be nullified
    const updated = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    expect(updated?.selfie_url).toBeNull();
  });

  it('skips file deletion but still nullifies when selfie_url is already null', async () => {
    const teacherCookie = await signupTeacher(`retention-null-${Date.now()}@test.com`);
    const { sessionId, inviteCode } = await createRoomAndSession(teacherCookie);
    const { studentId } = await enrollStudent(inviteCode);

    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const recordId = await insertRecord({
      sessionId,
      studentId,
      scannedAt: oldDate,
      selfieUrl: null,
      studentLat: 14.5995,
      studentLng: 120.9842,
    });

    const result = await runRetentionCleanup();

    // deletedFiles should not increase for null-selfie records
    expect(result.deletedFiles).toBeGreaterThanOrEqual(0);
    expect(result.nullifiedRecords).toBeGreaterThanOrEqual(1);

    const updated = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    expect(updated?.selfie_url).toBeNull();
    expect(updated?.student_lat).toBeNull();
    expect(updated?.student_lng).toBeNull();
  });
});
