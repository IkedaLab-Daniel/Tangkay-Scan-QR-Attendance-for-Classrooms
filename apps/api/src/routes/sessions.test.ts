import request from 'supertest';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import redis from '../lib/redis';
import * as tokenRotator from '../lib/tokenRotator';
import * as sseManager from '../lib/sseManager';

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
    .send({ name: 'Session Test Room', attendance_mode: 'balanced' });
  return res.body as { id: string; invite_code: string };
}

async function loginAsStudent(email: string, name: string, inviteCode: string): Promise<string> {
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

async function joinRoom(roomId: string, studentCookie: string): Promise<string> {
  const res = await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .set('Cookie', `access_token=${studentCookie}`);
  return (res.body as { id: string }).id;
}

async function makeOfficer(
  roomId: string,
  memberId: string,
  teacherCookie: string,
): Promise<void> {
  await request(app)
    .post(`/api/rooms/${roomId}/officers`)
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ memberId, officerTitle: 'Class Officer' });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Stop any active rotation intervals from previous tests before wiping DB/Redis
  tokenRotator.stopAll();
  await new Promise((r) => setTimeout(r, 20));

  await prisma.attendanceSession.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();
  // Clean up any lingering session Redis keys
  const keys = await redis.keys('session:*');
  if (keys.length) await redis.del(...keys);
  const magicKeys = await redis.keys('magic:*');
  if (magicKeys.length) await redis.del(...magicKeys);
});

afterAll(async () => {
  // Stop any remaining intervals before disconnecting
  tokenRotator.stopAll();
  await new Promise((r) => setTimeout(r, 20));

  await prisma.attendanceSession.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.$disconnect();
  redis.disconnect();
});

// ─── POST /api/sessions ────────────────────────────────────────────────────────

describe('POST /api/sessions — start session', () => {
  it('happy path — teacher starts session, Redis keys set, token returned', async () => {
    const { accessCookie } = await signupTeacher('ts-start1@test.com');
    const room = await createRoom(accessCookie);

    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id });

    expect(res.status).toBe(201);
    expect(res.body.room_id).toBe(room.id);
    expect(res.body.status).toBe('active');
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBe(16);
    expect(res.body.expiresAt).toBeDefined();

    // Verify Redis keys were written
    const sessionId = res.body.id;
    const currentToken = await redis.get(`session:${sessionId}:current_token`);
    expect(currentToken).toBe(res.body.token);

    const ttl = await redis.ttl(`session:${sessionId}:current_token`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it('happy path — officer starts session', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('ts-start2@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-start2@test.com', 'Officer', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);
    await makeOfficer(room.id, memberId, teacherCookie);

    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ roomId: room.id });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.token).toBeDefined();
    // started_by_officer_id should be set
    const session = await prisma.attendanceSession.findUnique({ where: { id: res.body.id } });
    expect(session?.started_by_officer_id).not.toBeNull();
  });

  it('409 when room already has an active session', async () => {
    const { accessCookie } = await signupTeacher('ts-start3@test.com');
    const room = await createRoom(accessCookie);

    // Start first session
    await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id });

    // Attempt second session on the same room
    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Room already has an active session');
  });

  it('401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ roomId: 'some-room-id' });

    expect(res.status).toBe(401);
  });

  it('403 when teacher does not own the room', async () => {
    const { accessCookie: owner } = await signupTeacher('ts-start4a@test.com');
    const { accessCookie: other } = await signupTeacher('ts-start4b@test.com');
    const room = await createRoom(owner);

    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${other}`)
      .send({ roomId: room.id });

    expect(res.status).toBe(403);
  });

  it('403 when non-officer student tries to start session', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('ts-start5@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-start5@test.com', 'Bob', room.invite_code);
    await joinRoom(room.id, studentCookie);
    // NOT made an officer

    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ roomId: room.id });

    expect(res.status).toBe(403);
  });

  it('accepts optional origin GPS fields', async () => {
    const { accessCookie } = await signupTeacher('ts-start6@test.com');
    const room = await createRoom(accessCookie);

    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id, originLat: 14.5995, originLng: 120.9842, originAccuracy: 5.0 });

    expect(res.status).toBe(201);
    expect(res.body.origin_lat).toBe(14.5995);
    expect(res.body.origin_lng).toBe(120.9842);
    expect(res.body.origin_accuracy).toBe(5.0);
  });
});

// ─── POST /api/sessions/:id/end ───────────────────────────────────────────────

describe('POST /api/sessions/:id/end — end session', () => {
  it('happy path — teacher ends session, status=ended, Redis keys deleted', async () => {
    const { accessCookie } = await signupTeacher('ts-end1@test.com');
    const room = await createRoom(accessCookie);

    const startRes = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id });

    const sessionId = startRes.body.id;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/end`)
      .set('Cookie', `access_token=${accessCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ended');
    expect(res.body.ended_at).not.toBeNull();

    // Redis keys should be deleted
    const currentToken = await redis.get(`session:${sessionId}:current_token`);
    expect(currentToken).toBeNull();
  });

  it('403 when a different teacher tries to end the session', async () => {
    const { accessCookie: owner } = await signupTeacher('ts-end2a@test.com');
    const { accessCookie: other } = await signupTeacher('ts-end2b@test.com');
    const room = await createRoom(owner);

    const startRes = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${owner}`)
      .send({ roomId: room.id });

    const sessionId = startRes.body.id;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/end`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });

  it('officer who started session can end it', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('ts-end3@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-end3@test.com', 'Officer', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);
    await makeOfficer(room.id, memberId, teacherCookie);

    const startRes = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ roomId: room.id });

    const sessionId = startRes.body.id;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/end`)
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ended');
  });

  it('404 for non-existent session', async () => {
    const { accessCookie } = await signupTeacher('ts-end4@test.com');

    const res = await request(app)
      .post('/api/sessions/nonexistentid000/end')
      .set('Cookie', `access_token=${accessCookie}`);

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/sessions/:id ────────────────────────────────────────────────────

describe('GET /api/sessions/:id — get session', () => {
  it('returns session when found and belongs to teacher', async () => {
    const { accessCookie } = await signupTeacher('ts-get1@test.com');
    const room = await createRoom(accessCookie);

    const startRes = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id });

    const sessionId = startRes.body.id;

    const res = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set('Cookie', `access_token=${accessCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sessionId);
    expect(res.body.room_id).toBe(room.id);
    expect(res.body.status).toBe('active');
  });

  it('returns 404 for non-existent session', async () => {
    const { accessCookie } = await signupTeacher('ts-get2@test.com');

    const res = await request(app)
      .get('/api/sessions/nonexistentid000')
      .set('Cookie', `access_token=${accessCookie}`);

    expect(res.status).toBe(404);
  });

  it('returns 403 when session belongs to a different teacher', async () => {
    const { accessCookie: owner } = await signupTeacher('ts-get3a@test.com');
    const { accessCookie: other } = await signupTeacher('ts-get3b@test.com');
    const room = await createRoom(owner);

    const startRes = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${owner}`)
      .send({ roomId: room.id });

    const sessionId = startRes.body.id;

    const res = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/sessions/:id/stream (SSE) ───────────────────────────────────────

describe('GET /api/sessions/:id/stream — SSE stream', () => {
  it('calls sseManager.subscribe with correct sessionId and sends SSE headers', async () => {
    const { accessCookie } = await signupTeacher('ts-stream1@test.com');
    const room = await createRoom(accessCookie);

    const startRes = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id });

    const sessionId = startRes.body.id;

    // Mock subscribe to immediately end the response so supertest doesn't hang
    const subscribeSpy = jest.spyOn(sseManager, 'subscribe').mockImplementation(
      (_sid: string, res: import('express').Response) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end();
      },
    );

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/stream`)
      .set('Cookie', `access_token=${accessCookie}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(subscribeSpy).toHaveBeenCalledWith(sessionId, expect.anything());

    subscribeSpy.mockRestore();
  });

  it('returns 401 when unauthenticated', async () => {
    const { accessCookie } = await signupTeacher('ts-stream2@test.com');
    const room = await createRoom(accessCookie);

    const startRes = await request(app)
      .post('/api/sessions')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ roomId: room.id });

    const sessionId = startRes.body.id;

    const res = await request(app).get(`/api/sessions/${sessionId}/stream`);
    expect(res.status).toBe(401);
  });
});

// ─── tokenRotator unit tests ───────────────────────────────────────────────────

describe('tokenRotator unit tests', () => {
  afterEach(async () => {
    // Clean up any test keys
    const keys = await redis.keys('session:test-*');
    if (keys.length) await redis.del(...keys);
  });

  it('startRotation writes current_token to Redis with 30s TTL', async () => {
    const sessionId = 'test-unit-1';
    const token = await tokenRotator.startRotation(sessionId);

    expect(typeof token).toBe('string');
    expect(token.length).toBe(16);

    const stored = await redis.get(`session:${sessionId}:current_token`);
    expect(stored).toBe(token);

    const ttl = await redis.ttl(`session:${sessionId}:current_token`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);

    // Clean up interval
    tokenRotator.stopRotation(sessionId);
  });

  it('getCurrentToken returns the stored token', async () => {
    const sessionId = 'test-unit-2';
    const token = await tokenRotator.startRotation(sessionId);

    const fetched = await tokenRotator.getCurrentToken(sessionId);
    expect(fetched).toBe(token);

    tokenRotator.stopRotation(sessionId);
  });

  it('getPrevToken returns null before any rotation', async () => {
    const sessionId = 'test-unit-3';
    await tokenRotator.startRotation(sessionId);

    // prev_token is only set on the second rotation, not the first
    const prev = await tokenRotator.getPrevToken(sessionId);
    expect(prev).toBeNull();

    tokenRotator.stopRotation(sessionId);
  });

  it('stopRotation deletes Redis keys and clears the interval', async () => {
    const sessionId = 'test-unit-4';
    await tokenRotator.startRotation(sessionId);

    tokenRotator.stopRotation(sessionId);

    // Wait briefly for the fire-and-forget del to complete
    await new Promise((r) => setTimeout(r, 50));

    const current = await redis.get(`session:${sessionId}:current_token`);
    expect(current).toBeNull();
  });
});
