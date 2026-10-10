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

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
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
    .send({ name: 'Test Room', attendance_mode: 'balanced' });
  return res.body as { id: string; invite_code: string };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();
  const keys = await redis.keys('rl:request-link:*');
  const keys2 = await redis.keys('rl:verify-code:*');
  const keys3 = await redis.keys('magic:*');
  const allKeys = [...keys, ...keys2, ...keys3];
  if (allKeys.length) await redis.del(...allKeys);
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

// ─── GET /api/rooms/join/:inviteCode ──────────────────────────────────────────

describe('GET /api/rooms/join/:inviteCode', () => {
  it('returns roomId, roomName, teacherName for valid code', async () => {
    const { accessCookie } = await signupTeacher('teacher1@test.com', 'Ms. Smith');
    const room = await createRoom(accessCookie);

    const res = await request(app).get(`/api/rooms/join/${room.invite_code}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      roomId: room.id,
      roomName: 'Test Room',
      teacherName: 'Ms. Smith',
    });
  });

  it('returns 404 for unknown invite code', async () => {
    const res = await request(app).get('/api/rooms/join/NOTREAL1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Invalid invite code');
  });
});

// ─── POST /api/auth/student/request-link ──────────────────────────────────────

describe('POST /api/auth/student/request-link', () => {
  it('stores Redis key and enqueues email job', async () => {
    const { accessCookie } = await signupTeacher('teacher2@test.com');
    const room = await createRoom(accessCookie);

    const res = await request(app)
      .post('/api/auth/student/request-link')
      .send({ name: 'Alice', email: 'alice@student.com', inviteCode: room.invite_code });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Check your email' });

    // Redis should have exactly one magic:* key
    const keys = await redis.keys('magic:*');
    expect(keys.length).toBe(1);

    const raw = await redis.get(keys[0]);
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw!);
    expect(payload).toMatchObject({ email: 'alice@student.com', name: 'Alice' });
  });

  it('returns 400 for invalid body', async () => {
    const res = await request(app)
      .post('/api/auth/student/request-link')
      .send({ name: 'A', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 404 for bad invite code', async () => {
    const res = await request(app)
      .post('/api/auth/student/request-link')
      .send({ name: 'Alice', email: 'alice@student.com', inviteCode: 'BADCODE' });
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/auth/student/verify/:token ──────────────────────────────────────

describe('GET /api/auth/student/verify/:token', () => {
  async function plantMagicToken(
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
    return token;
  }

  it('creates student, sets cookies, deletes Redis key', async () => {
    const { accessCookie } = await signupTeacher('teacher3@test.com');
    const room = await createRoom(accessCookie);
    const token = await plantMagicToken('bob@student.com', 'Bob', room.invite_code);

    const res = await request(app).get(`/api/auth/student/verify/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.student).toMatchObject({ name: 'Bob', email: 'bob@student.com' });

    // Cookie should be set
    const cookies = parseCookies(res);
    expect(cookies['access_token']).toBeDefined();

    // Redis key should be deleted
    const remaining = await redis.keys('magic:*');
    expect(remaining.length).toBe(0);

    // Student should be in DB
    const student = await prisma.student.findFirst({ where: { email: 'bob@student.com' } });
    expect(student).not.toBeNull();
  });

  it('returns existing student when email already exists', async () => {
    const { accessCookie } = await signupTeacher('teacher3b@test.com');
    const room = await createRoom(accessCookie);

    // Pre-create student
    await prisma.student.create({ data: { name: 'Bob Old', email: 'bob2@student.com' } });
    const token = await plantMagicToken('bob2@student.com', 'Bob New', room.invite_code);

    const res = await request(app).get(`/api/auth/student/verify/${token}`);

    expect(res.status).toBe(200);
    // Should not have created a duplicate
    const count = await prisma.student.count({ where: { email: 'bob2@student.com' } });
    expect(count).toBe(1);
  });

  it('returns 400 for invalid/expired token', async () => {
    const res = await request(app).get('/api/auth/student/verify/totallybadtoken');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired magic link');
  });
});

// ─── POST /api/auth/student/verify-code ───────────────────────────────────────

describe('POST /api/auth/student/verify-code', () => {
  async function createStudentWithCode(
    plainCode: string,
  ): Promise<{ id: string }> {
    const codeHash = sha256(plainCode);
    return prisma.student.create({
      data: {
        name: 'Carol',
        join_code: codeHash,
        magic_link_expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1h from now
      },
    });
  }

  it('happy path — authenticates student and clears code', async () => {
    const { accessCookie } = await signupTeacher('teacher4@test.com');
    const room = await createRoom(accessCookie);
    await createStudentWithCode('123456');

    const res = await request(app)
      .post('/api/auth/student/verify-code')
      .send({ joinCode: '123456', inviteCode: room.invite_code });

    expect(res.status).toBe(200);
    expect(res.body.student).toMatchObject({ name: 'Carol' });

    const cookies = parseCookies(res);
    expect(cookies['access_token']).toBeDefined();

    // Code should be cleared
    const student = await prisma.student.findFirst({ where: { name: 'Carol' } });
    expect(student?.join_code).toBeNull();
  });

  it('expired code returns 401', async () => {
    const { accessCookie } = await signupTeacher('teacher4b@test.com');
    const room = await createRoom(accessCookie);

    const codeHash = sha256('654321');
    await prisma.student.create({
      data: {
        name: 'Dave',
        join_code: codeHash,
        magic_link_expires_at: new Date(Date.now() - 1000), // already expired
      },
    });

    const res = await request(app)
      .post('/api/auth/student/verify-code')
      .send({ joinCode: '654321', inviteCode: room.invite_code });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Join code expired');
  });

  it('invalid code returns 401', async () => {
    const { accessCookie } = await signupTeacher('teacher4c@test.com');
    const room = await createRoom(accessCookie);

    const res = await request(app)
      .post('/api/auth/student/verify-code')
      .send({ joinCode: '000000', inviteCode: room.invite_code });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid join code');
  });

  it('bad invite code returns 404', async () => {
    const res = await request(app)
      .post('/api/auth/student/verify-code')
      .send({ joinCode: '111111', inviteCode: 'BADCODE1' });
    expect(res.status).toBe(404);
  });

  it('validation failure on short code returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/student/verify-code')
      .send({ joinCode: '12345', inviteCode: 'ANYCODE1' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/auth/student/me ─────────────────────────────────────────────────

describe('GET /api/auth/student/me', () => {
  async function loginAsStudent(): Promise<string> {
    const { accessCookie } = await signupTeacher('teacher5@test.com');
    const room = await createRoom(accessCookie);

    const token = crypto.randomBytes(32).toString('hex');
    await redis.set(
      `magic:${token}`,
      JSON.stringify({ email: 'student5@test.com', name: 'Eve', inviteCode: room.invite_code }),
      'EX',
      900,
    );
    const res = await request(app).get(`/api/auth/student/verify/${token}`);
    return parseCookies(res)['access_token'];
  }

  it('returns student profile when authenticated', async () => {
    const studentCookie = await loginAsStudent();

    const res = await request(app)
      .get('/api/auth/student/me')
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Eve', email: 'student5@test.com' });
    expect(res.body.id).toBeDefined();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/student/me');
    expect(res.status).toBe(401);
  });

  it('returns 403 when using a teacher token', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('teacher5b@test.com');

    const res = await request(app)
      .get('/api/auth/student/me')
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/auth/student/refresh ───────────────────────────────────────────

describe('POST /api/auth/student/refresh', () => {
  it('issues new access token from valid refresh cookie', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('teacher6@test.com');
    const room = await createRoom(teacherCookie);

    const token = crypto.randomBytes(32).toString('hex');
    await redis.set(
      `magic:${token}`,
      JSON.stringify({ email: 'student6@test.com', name: 'Frank', inviteCode: room.invite_code }),
      'EX',
      900,
    );
    const verifyRes = await request(app).get(`/api/auth/student/verify/${token}`);
    const refreshCookie = parseCookies(verifyRes)['refresh_token'];

    const res = await request(app)
      .post('/api/auth/student/refresh')
      .set('Cookie', `refresh_token=${refreshCookie}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(parseCookies(res)['access_token']).toBeDefined();
  });

  it('returns 401 without refresh cookie', async () => {
    const res = await request(app).post('/api/auth/student/refresh');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/auth/student/logout ────────────────────────────────────────────

describe('POST /api/auth/student/logout', () => {
  it('clears cookies', async () => {
    const res = await request(app).post('/api/auth/student/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ─── POST /api/rooms/:id/join-codes ───────────────────────────────────────────

describe('POST /api/rooms/:id/join-codes', () => {
  it('creates student with hashed code and returns plaintext code', async () => {
    const { accessCookie } = await signupTeacher('teacher7@test.com');
    const room = await createRoom(accessCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/join-codes`)
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ studentName: 'Grace', parentEmail: 'parent@test.com' });

    expect(res.status).toBe(201);
    expect(res.body.joinCode).toMatch(/^\d{6}$/);
    expect(res.body.studentId).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();

    // Student in DB should have a hashed code, not plaintext
    const student = await prisma.student.findUnique({ where: { id: res.body.studentId } });
    expect(student?.join_code).toBe(sha256(res.body.joinCode));
    expect(student?.join_code).not.toBe(res.body.joinCode);
  });

  it('returns 403 when room belongs to another teacher', async () => {
    const { accessCookie: c1 } = await signupTeacher('teacher7a@test.com', 'T1');
    const { accessCookie: c2 } = await signupTeacher('teacher7b@test.com', 'T2');
    const room = await createRoom(c1);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/join-codes`)
      .set('Cookie', `access_token=${c2}`)
      .send({ studentName: 'Hack' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent room', async () => {
    const { accessCookie } = await signupTeacher('teacher7c@test.com');

    const res = await request(app)
      .post('/api/rooms/nonexistent123/join-codes')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ studentName: 'Ghost' });

    expect(res.status).toBe(404);
  });
});
