import request from 'supertest';
import crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import app from '../index';
import redis from '../lib/redis';
import * as tokenRotator from '../lib/tokenRotator';

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

async function signupTeacher(email: string, name = 'Teacher'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/teacher/signup')
    .send({ name, email, password: 'password123' });
  return parseCookies(res)['access_token'];
}

async function createRoom(
  teacherCookie: string,
): Promise<{ id: string; invite_code: string }> {
  const res = await request(app)
    .post('/api/rooms')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ name: 'Dashboard Test Room', attendance_mode: 'balanced' });
  return res.body as { id: string; invite_code: string };
}

async function loginStudent(email: string, name: string, inviteCode: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(`magic:${token}`, JSON.stringify({ email, name, inviteCode }), 'EX', 900);
  const res = await request(app).get(`/api/auth/student/verify/${token}`);
  return parseCookies(res)['access_token'];
}

async function joinRoom(roomId: string, studentCookie: string): Promise<string> {
  const res = await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .set('Cookie', `access_token=${studentCookie}`);
  return (res.body as { id: string }).id;
}

async function startSession(teacherCookie: string, roomId: string): Promise<string> {
  const res = await request(app)
    .post('/api/sessions')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ roomId });
  return (res.body as { id: string }).id;
}

/** Directly insert an attendance record with controlled fields */
async function createRecord(
  sessionId: string,
  studentId: string,
  overrides: Partial<{
    approval_status: 'approved' | 'pending' | 'rejected';
    location_flag: 'verified' | 'unverified' | 'mismatch';
    risk_score: 'low' | 'medium' | 'high';
    method: 'qr_scan' | 'manual';
    marked_by_officer_id: string | null;
  }> = {},
): Promise<string> {
  const record = await prisma.attendanceRecord.create({
    data: {
      session_id: sessionId,
      student_id: studentId,
      method: overrides.method ?? 'qr_scan',
      marked_by_officer_id: overrides.marked_by_officer_id ?? null,
      approval_status: overrides.approval_status ?? 'approved',
      location_flag: overrides.location_flag ?? 'verified',
      risk_score: overrides.risk_score ?? 'low',
      risk_signals: [] as unknown as Prisma.InputJsonValue,
      gps_readings: [] as unknown as Prisma.InputJsonValue,
    },
  });
  return record.id;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  tokenRotator.stopAll();
  await new Promise((r) => setTimeout(r, 20));

  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();

  const keys = await redis.keys('session:*');
  if (keys.length) await redis.del(...keys);
  const magicKeys = await redis.keys('magic:*');
  if (magicKeys.length) await redis.del(...magicKeys);
});

afterAll(async () => {
  tokenRotator.stopAll();
  await new Promise((r) => setTimeout(r, 20));

  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.$disconnect();
  redis.disconnect();
});

// ─── GET /api/rooms/:id/sessions ─────────────────────────────────────────────

describe('GET /api/rooms/:id/sessions — list sessions', () => {
  it('returns sessions with correct summary counts', async () => {
    const teacherCookie = await signupTeacher('db-ls1@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('db-ls1-s@test.com', 'Student A', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);
    const studentId = (await prisma.roomMember.findUnique({ where: { id: memberId }, select: { student_id: true } }))!.student_id;

    const sessionId = await startSession(teacherCookie, room.id);

    // approved record → presentCount
    await createRecord(sessionId, studentId, { approval_status: 'approved', location_flag: 'verified', risk_score: 'low' });

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const s = res.body.data[0];
    expect(s.id).toBe(sessionId);
    expect(s.presentCount).toBe(1);
    expect(s.flaggedCount).toBe(0);
    expect(s.pendingApprovalCount).toBe(0);
    expect(res.body.pagination.total).toBe(1);
  });

  it('correctly counts flaggedCount for mismatch location_flag and high risk_score', async () => {
    const teacherCookie = await signupTeacher('db-ls2@test.com');
    const room = await createRoom(teacherCookie);

    // Need two distinct students to avoid unique constraint on (session_id, student_id)
    const cookie1 = await loginStudent('db-ls2-s1@test.com', 'S1', room.invite_code);
    const m1 = await joinRoom(room.id, cookie1);
    const s1Id = (await prisma.roomMember.findUnique({ where: { id: m1 }, select: { student_id: true } }))!.student_id;

    const cookie2 = await loginStudent('db-ls2-s2@test.com', 'S2', room.invite_code);
    const m2 = await joinRoom(room.id, cookie2);
    const s2Id = (await prisma.roomMember.findUnique({ where: { id: m2 }, select: { student_id: true } }))!.student_id;

    const sessionId = await startSession(teacherCookie, room.id);

    await createRecord(sessionId, s1Id, { location_flag: 'mismatch', risk_score: 'low' });
    await createRecord(sessionId, s2Id, { location_flag: 'verified', risk_score: 'high' });

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    const s = res.body.data[0];
    expect(s.flaggedCount).toBe(2);
  });

  it('pagination works — page and limit are respected', async () => {
    const teacherCookie = await signupTeacher('db-ls3@test.com');
    const room = await createRoom(teacherCookie);

    // Create 3 sessions directly
    for (let i = 0; i < 3; i++) {
      await prisma.attendanceSession.create({ data: { room_id: room.id, status: 'ended' } });
    }

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions?page=1&limit=2`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
    expect(res.body.pagination.limit).toBe(2);
  });

  it('returns 403 when teacher does not own the room', async () => {
    const owner = await signupTeacher('db-ls4a@test.com');
    const other = await signupTeacher('db-ls4b@test.com');
    const room = await createRoom(owner);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const teacherCookie = await signupTeacher('db-ls5@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app).get(`/api/rooms/${room.id}/sessions`);
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/sessions/:id/records ───────────────────────────────────────────

describe('GET /api/sessions/:id/records — list records', () => {
  // Helper: set up teacher + room + two students + session
  async function setup(emailPrefix: string) {
    const teacherCookie = await signupTeacher(`${emailPrefix}-t@test.com`);
    const room = await createRoom(teacherCookie);

    const cookie1 = await loginStudent(`${emailPrefix}-s1@test.com`, 'S1', room.invite_code);
    const m1 = await joinRoom(room.id, cookie1);
    const s1Id = (await prisma.roomMember.findUnique({ where: { id: m1 }, select: { student_id: true } }))!.student_id;

    const cookie2 = await loginStudent(`${emailPrefix}-s2@test.com`, 'S2', room.invite_code);
    const m2 = await joinRoom(room.id, cookie2);
    const s2Id = (await prisma.roomMember.findUnique({ where: { id: m2 }, select: { student_id: true } }))!.student_id;

    const sessionId = await startSession(teacherCookie, room.id);
    return { teacherCookie, room, s1Id, s2Id, sessionId };
  }

  it('all filter returns all records', async () => {
    const { teacherCookie, s1Id, s2Id, sessionId } = await setup('db-lr1');

    await createRecord(sessionId, s1Id, { approval_status: 'approved' });
    await createRecord(sessionId, s2Id, { approval_status: 'pending' });

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records?filter=all`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it('flagged filter returns only flagged records', async () => {
    const { teacherCookie, s1Id, s2Id, sessionId } = await setup('db-lr2');

    await createRecord(sessionId, s1Id, { location_flag: 'mismatch', risk_score: 'low' });
    await createRecord(sessionId, s2Id, { location_flag: 'verified', risk_score: 'low' });

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records?filter=flagged`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].location_flag).toBe('mismatch');
  });

  it('flagged filter includes unverified location flag', async () => {
    const { teacherCookie, s1Id, sessionId } = await setup('db-lr2b');

    await createRecord(sessionId, s1Id, { location_flag: 'unverified', risk_score: 'low' });

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records?filter=flagged`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('pending_approval filter returns only pending records', async () => {
    const { teacherCookie, s1Id, s2Id, sessionId } = await setup('db-lr3');

    await createRecord(sessionId, s1Id, { approval_status: 'pending' });
    await createRecord(sessionId, s2Id, { approval_status: 'approved' });

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records?filter=pending_approval`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].approval_status).toBe('pending');
  });

  it('pagination works', async () => {
    const { teacherCookie, s1Id, s2Id, sessionId } = await setup('db-lr4');

    await createRecord(sessionId, s1Id, { approval_status: 'approved' });
    await createRecord(sessionId, s2Id, { approval_status: 'approved' });

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records?page=1&limit=1`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('returns 403 when teacher does not own the session room', async () => {
    const { sessionId } = await setup('db-lr5a');
    const other = await signupTeacher('db-lr5b@test.com');

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });

  it('returns record with student info and parsed risk_signals', async () => {
    const { teacherCookie, s1Id, sessionId } = await setup('db-lr6');

    await createRecord(sessionId, s1Id, { approval_status: 'approved', risk_score: 'low' });

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    const record = res.body.data[0];
    expect(record.student).toMatchObject({ name: 'S1' });
    expect(record.risk_signals).toBeDefined();
    expect(Array.isArray(record.risk_signals)).toBe(true);
  });
});

// ─── GET /api/sessions/:id/records/:recordId — record detail ─────────────────

describe('GET /api/sessions/:id/records/:recordId — record detail', () => {
  async function setup(emailPrefix: string) {
    const teacherCookie = await signupTeacher(`${emailPrefix}-t@test.com`);
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent(`${emailPrefix}-s@test.com`, 'S', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);
    const studentId = (await prisma.roomMember.findUnique({ where: { id: memberId }, select: { student_id: true } }))!.student_id;
    const sessionId = await startSession(teacherCookie, room.id);
    return { teacherCookie, sessionId, studentId, room };
  }

  it('returns full record details', async () => {
    const { teacherCookie, sessionId, studentId } = await setup('db-rd1');
    const recordId = await createRecord(sessionId, studentId, {
      approval_status: 'approved',
      location_flag: 'verified',
      risk_score: 'low',
    });

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records/${recordId}`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(recordId);
    expect(res.body.student).toBeDefined();
    expect(res.body.student.name).toBe('S');
    expect(res.body.session).toBeDefined();
    expect(res.body.session.id).toBe(sessionId);
    expect(res.body.session.room).toBeDefined();
    expect(res.body.gps_readings).toBeDefined();
    expect(res.body.risk_signals).toBeDefined();
    expect(res.body.location_flag).toBe('verified');
    expect(res.body.risk_score).toBe('low');
  });

  it('returns 404 for non-existent record', async () => {
    const { teacherCookie, sessionId } = await setup('db-rd2');

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records/nonexistentrecord`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 when recordId belongs to a different session', async () => {
    const teacherCookie = await signupTeacher('db-rd3@test.com');
    const room = await createRoom(teacherCookie);

    const cookie = await loginStudent('db-rd3-s@test.com', 'S', room.invite_code);
    const memberId = await joinRoom(room.id, cookie);
    const studentId = (await prisma.roomMember.findUnique({ where: { id: memberId }, select: { student_id: true } }))!.student_id;

    // Create two sessions and a record in session2 only
    const session1Id = await startSession(teacherCookie, room.id);
    await prisma.attendanceSession.update({ where: { id: session1Id }, data: { status: 'ended', ended_at: new Date() } });
    const session2Id = await startSession(teacherCookie, room.id);

    const recordId = await createRecord(session2Id, studentId, {});

    // Try to fetch session2's record via session1's path
    const res = await request(app)
      .get(`/api/sessions/${session1Id}/records/${recordId}`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
  });

  it('returns 403 when teacher does not own the session room', async () => {
    const { sessionId, studentId } = await setup('db-rd4a');
    const other = await signupTeacher('db-rd4b@test.com');
    const recordId = await createRecord(sessionId, studentId, {});

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records/${recordId}`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/rooms/:id/sessions/:sessionId/export ───────────────────────────

describe('GET /api/rooms/:id/sessions/:sessionId/export — CSV export', () => {
  async function setup(emailPrefix: string) {
    const teacherCacher = await signupTeacher(`${emailPrefix}-t@test.com`);
    const room = await createRoom(teacherCacher);

    const cookie1 = await loginStudent(`${emailPrefix}-s1@test.com`, 'Alice', room.invite_code);
    const m1 = await joinRoom(room.id, cookie1);
    const s1Id = (await prisma.roomMember.findUnique({ where: { id: m1 }, select: { student_id: true } }))!.student_id;

    const cookie2 = await loginStudent(`${emailPrefix}-s2@test.com`, 'Bob', room.invite_code);
    const m2 = await joinRoom(room.id, cookie2);
    const s2Id = (await prisma.roomMember.findUnique({ where: { id: m2 }, select: { student_id: true } }))!.student_id;

    const sessionId = await startSession(teacherCacher, room.id);
    return { teacherCookie: teacherCacher, room, s1Id, s2Id, sessionId };
  }

  it('returns 200 text/csv with correct headers and row count', async () => {
    const { teacherCookie, room, s1Id, s2Id, sessionId } = await setup('db-csv1');

    await createRecord(sessionId, s1Id, { approval_status: 'approved' });
    await createRecord(sessionId, s2Id, { approval_status: 'pending' });

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions/${sessionId}/export`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="attendance-${sessionId}.csv"`,
    );

    const lines = (res.text as string).trim().split('\n');
    // header + 2 data rows
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'student_name,student_email,method,approval_status,location_flag,risk_score,scanned_at',
    );
  });

  it('exports all records without pagination', async () => {
    const { teacherCookie, room, s1Id, s2Id, sessionId } = await setup('db-csv2');

    await createRecord(sessionId, s1Id, {});
    await createRecord(sessionId, s2Id, {});

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions/${sessionId}/export`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const lines = (res.text as string).trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('returns 403 when teacher does not own the room', async () => {
    const { room, sessionId } = await setup('db-csv3a');
    const other = await signupTeacher('db-csv3b@test.com');

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions/${sessionId}/export`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 when session does not belong to the room', async () => {
    const teacherCookie = await signupTeacher('db-csv4@test.com');
    const room = await createRoom(teacherCookie);

    // Create a session in a different room owned by same teacher
    const room2 = await createRoom(teacherCookie);
    const session2Id = await startSession(teacherCookie, room2.id);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions/${session2Id}/export`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
  });

  it('returns CSV with empty data rows when no records exist', async () => {
    const teacherCookie = await signupTeacher('db-csv5@test.com');
    const room = await createRoom(teacherCookie);
    const sessionId = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/sessions/${sessionId}/export`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    const lines = (res.text as string).trim().split('\n');
    expect(lines).toHaveLength(1); // header only
  });
});
