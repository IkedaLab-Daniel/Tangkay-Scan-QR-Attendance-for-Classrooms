import request from 'supertest';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import redis from '../lib/redis';

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

async function signupTeacher(email: string, name = 'Teacher'): Promise<{ accessCookie: string }> {
  const res = await request(app)
    .post('/api/auth/teacher/signup')
    .send({ name, email, password: 'password123' });
  return { accessCookie: parseCookies(res)['access_token'] };
}

async function createRoom(accessCookie: string): Promise<{ id: string; invite_code: string }> {
  const res = await request(app)
    .post('/api/rooms')
    .set('Cookie', `access_token=${accessCookie}`)
    .send({ name: 'Join Test Room', attendance_mode: 'balanced' });
  return res.body as { id: string; invite_code: string };
}

async function loginAsStudent(
  email: string,
  name: string,
  inviteCode: string,
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(
    `magic:${token}`,
    JSON.stringify({ email, name, inviteCode }),
    'EX',
    900,
  );
  const res = await request(app).get(`/api/auth/student/verify/${token}`);
  return parseCookies(res)['access_token'];
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();
  const keys = await redis.keys('magic:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.$disconnect();
  redis.disconnect();
});

// ─── POST /api/rooms/:id/join ─────────────────────────────────────────────────

describe('POST /api/rooms/:id/join', () => {
  it('happy path — creates room_member with role student', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('jt1@test.com', 'Ms. Jones');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s1@test.com', 'Sam', room.invite_code);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/join`)
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ room_id: room.id, role: 'student' });
    expect(res.body.id).toBeDefined();

    // Verify DB record
    const member = await prisma.roomMember.findFirst({ where: { room_id: room.id } });
    expect(member).not.toBeNull();
    expect(member?.role).toBe('student');
  });

  it('returns 409 when student already a member', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('jt2@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s2@test.com', 'Sam2', room.invite_code);

    // First join — success
    await request(app)
      .post(`/api/rooms/${room.id}/join`)
      .set('Cookie', `access_token=${studentCookie}`);

    // Second join — conflict
    const res = await request(app)
      .post(`/api/rooms/${room.id}/join`)
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already a member of this room');
  });

  it('returns 404 for non-existent room', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('jt3@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s3@test.com', 'Sam3', room.invite_code);

    const res = await request(app)
      .post('/api/rooms/nonexistentroom/join')
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('jt4@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app).post(`/api/rooms/${room.id}/join`);
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/rooms/:id/join/consent ─────────────────────────────────────────

describe('POST /api/rooms/:id/join/consent', () => {
  async function setupMember(): Promise<{
    roomId: string;
    studentCookie: string;
    studentId: string;
  }> {
    const { accessCookie: teacherCookie } = await signupTeacher(
      `jt-consent-${Date.now()}@test.com`,
    );
    const room = await createRoom(teacherCookie);
    const studentEmail = `sc-${Date.now()}@test.com`;
    const studentCookie = await loginAsStudent(studentEmail, 'Consent Student', room.invite_code);

    await request(app)
      .post(`/api/rooms/${room.id}/join`)
      .set('Cookie', `access_token=${studentCookie}`);

    const student = await prisma.student.findFirst({ where: { email: studentEmail } });
    return { roomId: room.id, studentCookie, studentId: student!.id };
  }

  it('grant — updates student consent_status to granted', async () => {
    const { roomId, studentCookie, studentId } = await setupMember();

    const res = await request(app)
      .post(`/api/rooms/${roomId}/join/consent`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ status: 'granted' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'granted' });

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    expect(student?.consent_status).toBe('granted');
  });

  it('deny — updates student consent_status to denied', async () => {
    const { roomId, studentCookie, studentId } = await setupMember();

    const res = await request(app)
      .post(`/api/rooms/${roomId}/join/consent`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ status: 'denied' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'denied' });

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    expect(student?.consent_status).toBe('denied');
  });

  it('returns 400 for invalid status value', async () => {
    const { roomId, studentCookie } = await setupMember();

    const res = await request(app)
      .post(`/api/rooms/${roomId}/join/consent`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ status: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 404 when student not a member', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('jt-consent2@test.com');
    const room = await createRoom(teacherCookie);

    // Log in as a student but don't join the room
    const studentEmail = 'nonmember@test.com';
    const studentCookie = await loginAsStudent(studentEmail, 'NonMember', room.invite_code);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/join/consent`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ status: 'granted' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not a member of this room');
  });

  it('returns 401 when unauthenticated', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('jt-consent3@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/join/consent`)
      .send({ status: 'granted' });

    expect(res.status).toBe(401);
  });
});
