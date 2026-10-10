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
    .send({ name: 'Officer Test Room', attendance_mode: 'balanced' });
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

/** Joins a student to a room and returns the room_member id */
async function joinRoom(roomId: string, studentCookie: string): Promise<string> {
  const res = await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .set('Cookie', `access_token=${studentCookie}`);
  return (res.body as { id: string }).id;
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

// ─── POST /api/rooms/:id/officers ─────────────────────────────────────────────

describe('POST /api/rooms/:id/officers — assign officer', () => {
  it('happy path — updates role to officer with title', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-assign1@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-assign1@test.com', 'Sam', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ memberId, officerTitle: 'Class President' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: memberId, role: 'officer', officer_title: 'Class President' });

    const member = await prisma.roomMember.findUnique({ where: { id: memberId } });
    expect(member?.role).toBe('officer');
    expect(member?.officer_title).toBe('Class President');
  });

  it('returns 404 when memberId does not belong to this room', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-assign2@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ memberId: '00000000-0000-0000-0000-000000000000', officerTitle: 'Sec' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Member not found in this room');
  });

  it('returns 401 when unauthenticated', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-assign3@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .send({ memberId: '00000000-0000-0000-0000-000000000000', officerTitle: 'Sec' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when teacher does not own the room', async () => {
    const { accessCookie: owner } = await signupTeacher('t-assign4a@test.com');
    const { accessCookie: other } = await signupTeacher('t-assign4b@test.com');
    const room = await createRoom(owner);
    const studentCookie = await loginAsStudent('s-assign4@test.com', 'Sam', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${other}`)
      .send({ memberId, officerTitle: 'Treasurer' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when officerTitle exceeds 50 chars', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-assign5@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-assign5@test.com', 'Sam', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ memberId, officerTitle: 'A'.repeat(51) });

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/rooms/:id/officers/:memberId ─────────────────────────────────

describe('DELETE /api/rooms/:id/officers/:memberId — revoke officer', () => {
  it('happy path — resets role to student and clears officer_title', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-revoke1@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-revoke1@test.com', 'Sam', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);

    // Assign first
    await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ memberId, officerTitle: 'Class President' });

    const res = await request(app)
      .delete(`/api/rooms/${room.id}/officers/${memberId}`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: memberId, role: 'student', officer_title: null });

    const member = await prisma.roomMember.findUnique({ where: { id: memberId } });
    expect(member?.role).toBe('student');
    expect(member?.officer_title).toBeNull();
  });

  it('returns 404 when member not found in room', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-revoke2@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app)
      .delete(`/api/rooms/${room.id}/officers/nonexistent-id`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Member not found in this room');
  });

  it('returns 403 when teacher does not own the room', async () => {
    const { accessCookie: owner } = await signupTeacher('t-revoke3a@test.com');
    const { accessCookie: other } = await signupTeacher('t-revoke3b@test.com');
    const room = await createRoom(owner);
    const studentCookie = await loginAsStudent('s-revoke3@test.com', 'Sam', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);

    const res = await request(app)
      .delete(`/api/rooms/${room.id}/officers/${memberId}`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/rooms/:id/members ───────────────────────────────────────────────

describe('GET /api/rooms/:id/members — list members', () => {
  it('returns all members, officers sorted first', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-list1@test.com');
    const room = await createRoom(teacherCookie);

    // Enroll two students
    const cookie1 = await loginAsStudent('s-list1a@test.com', 'Zelda', room.invite_code);
    const cookie2 = await loginAsStudent('s-list1b@test.com', 'Anna', room.invite_code);
    const mem1 = await joinRoom(room.id, cookie1);
    const mem2 = await joinRoom(room.id, cookie2);

    // Make Zelda an officer
    await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ memberId: mem1, officerTitle: 'President' });

    const res = await request(app)
      .get(`/api/rooms/${room.id}/members`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Officers come first (role: 'officer' < 'student' alphabetically)
    expect(res.body[0].role).toBe('officer');
    expect(res.body[1].role).toBe('student');
    expect(res.body[0].id).toBe(mem1);
    expect(res.body[1].id).toBe(mem2);
  });

  it('returns 403 when teacher does not own the room', async () => {
    const { accessCookie: owner } = await signupTeacher('t-list2a@test.com');
    const { accessCookie: other } = await signupTeacher('t-list2b@test.com');
    const room = await createRoom(owner);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/members`)
      .set('Cookie', `access_token=${other}`);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-list3@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app).get(`/api/rooms/${room.id}/members`);

    expect(res.status).toBe(401);
  });

  it('includes student name and email in each member record', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-list4@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-list4@test.com', 'Alex', room.invite_code);
    await joinRoom(room.id, studentCookie);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/members`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body[0].student).toBeDefined();
    expect(res.body[0].student.name).toBe('Alex');
    expect(res.body[0].student.email).toBe('s-list4@test.com');
    expect(res.body[0]).toHaveProperty('joined_at');
    expect(res.body[0]).toHaveProperty('officer_title');
  });
});

// ─── requireOfficer middleware ─────────────────────────────────────────────────

describe('requireOfficer middleware', () => {
  it('officer passes — returns 200 from a guarded route', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-og1@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-og1@test.com', 'Alex', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);

    await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ memberId, officerTitle: 'Treasurer' });

    // DELETE is a teacher-only route not guarded by requireOfficer;
    // we test the middleware directly via a student-assigned officer calling
    // a future route. For now, verify the assigned member record is officer in DB.
    const member = await prisma.roomMember.findUnique({ where: { id: memberId } });
    expect(member?.role).toBe('officer');
  });

  it('non-officer student gets 403 from officerGuard', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-og2@test.com');
    const room = await createRoom(teacherCookie);

    // Mount a test route dynamically using the middleware
    const { requireOfficer } = await import('../middleware/officerGuard');
    const express = await import('express');
    const testApp = express.default();
    const cookieParser = (await import('cookie-parser')).default;
    testApp.use(cookieParser());
    testApp.use(express.default.json());

    const { requireAuth } = await import('../middleware/auth');
    testApp.get(
      '/test-rooms/:id/probe',
      requireAuth('student'),
      requireOfficer('id'),
      (_req: import('express').Request, res: import('express').Response) => {
        res.json({ ok: true });
      },
    );

    // Student joins but is NOT made officer
    const studentCookie = await loginAsStudent('s-og2@test.com', 'Bob', room.invite_code);
    await joinRoom(room.id, studentCookie);

    const res = await request(testApp)
      .get(`/test-rooms/${room.id}/probe`)
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: officer role required');
  });

  it('non-member student gets 403 from officerGuard', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-og3@test.com');
    const room = await createRoom(teacherCookie);

    const { requireOfficer } = await import('../middleware/officerGuard');
    const express = await import('express');
    const testApp = express.default();
    const cookieParser = (await import('cookie-parser')).default;
    testApp.use(cookieParser());
    testApp.use(express.default.json());

    const { requireAuth } = await import('../middleware/auth');
    testApp.get(
      '/test-rooms/:id/probe',
      requireAuth('student'),
      requireOfficer('id'),
      (_req: import('express').Request, res: import('express').Response) => {
        res.json({ ok: true });
      },
    );

    // Student is authenticated but never joined the room
    const studentCookie = await loginAsStudent('s-og3@test.com', 'NonMember', room.invite_code);

    const res = await request(testApp)
      .get(`/test-rooms/${room.id}/probe`)
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: officer role required');
  });

  it('officer student passes officerGuard and gets 200', async () => {
    const { accessCookie: teacherCookie } = await signupTeacher('t-og4@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginAsStudent('s-og4@test.com', 'Officer', room.invite_code);
    const memberId = await joinRoom(room.id, studentCookie);

    // Elevate to officer
    await request(app)
      .post(`/api/rooms/${room.id}/officers`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ memberId, officerTitle: 'VP' });

    const { requireOfficer } = await import('../middleware/officerGuard');
    const express = await import('express');
    const testApp = express.default();
    const cookieParser = (await import('cookie-parser')).default;
    testApp.use(cookieParser());
    testApp.use(express.default.json());

    const { requireAuth } = await import('../middleware/auth');
    testApp.get(
      '/test-rooms/:id/probe',
      requireAuth('student'),
      requireOfficer('id'),
      (_req: import('express').Request, res: import('express').Response) => {
        res.json({ ok: true });
      },
    );

    const res = await request(testApp)
      .get(`/test-rooms/${room.id}/probe`)
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
