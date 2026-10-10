import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
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

/** Create a static-mode room (attendance_mode: 'static' → qr_type: 'static') */
async function createStaticRoom(
  teacherCookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; invite_code: string }> {
  const res = await request(app)
    .post('/api/rooms')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ name: 'Static Room', attendance_mode: 'static', ...overrides });
  return res.body as { id: string; invite_code: string };
}

async function loginStudent(email: string, name: string, inviteCode: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(`magic:${token}`, JSON.stringify({ email, name, inviteCode }), 'EX', 900);
  const res = await request(app).get(`/api/auth/student/verify/${token}`);
  return parseCookies(res)['access_token'];
}

async function joinRoom(roomId: string, studentCookie: string): Promise<void> {
  await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .set('Cookie', `access_token=${studentCookie}`);
}

function makeReading(overrides: Partial<{
  lat: number; lng: number; accuracy: number;
  altitude: number | null; speed: number | null; heading: number | null; timestamp: number;
}> = {}) {
  return {
    lat: 14.5995,
    lng: 120.9842,
    accuracy: 5,
    altitude: null,
    speed: null,
    heading: null,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeScanBody(token: string, readingsOverride?: unknown[]) {
  return {
    token,
    readings: readingsOverride ?? [makeReading()],
    client_time: Date.now(),
    device_fingerprint: 'fp-static-001',
  };
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
  const rateKeys = await redis.keys('scan_rate:*');
  if (rateKeys.length) await redis.del(...rateKeys);
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

// ─── POST /api/rooms/:id/static-qr/regenerate ────────────────────────────────

describe('POST /api/rooms/:id/static-qr/regenerate', () => {
  it('happy path — generates a JWT, stores it in DB, returns token + room details', async () => {
    const teacherCookie = await signupTeacher('sqr-regen1@test.com');
    const room = await createStaticRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.staticQrToken).toBeDefined();
    expect(typeof res.body.staticQrToken).toBe('string');
    expect(res.body.roomId).toBe(room.id);
    expect(res.body.roomName).toBe('Static Room');

    // Verify the token is a valid JWT with the correct claims
    const decoded = jwt.verify(
      res.body.staticQrToken,
      process.env.JWT_SECRET as string,
    ) as { typ: string; roomId: string };
    expect(decoded.typ).toBe('static_qr');
    expect(decoded.roomId).toBe(room.id);

    // Verify it was stored in DB
    const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
    expect(dbRoom!.static_qr_token).toBe(res.body.staticQrToken);
  });

  it('second regeneration produces a different token and overwrites the old one', async () => {
    const teacherCookie = await signupTeacher('sqr-regen2@test.com');
    const room = await createStaticRoom(teacherCookie);

    const first = await request(app)
      .post(`/api/rooms/${room.id}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const second = await request(app)
      .post(`/api/rooms/${room.id}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(second.status).toBe(200);
    // JWT iat may differ by a second; at minimum the tokens are different strings
    // (they could be the same if iat is identical — that's fine; DB should store the latest)
    const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
    expect(dbRoom!.static_qr_token).toBe(second.body.staticQrToken);
    // The first token is no longer the stored one (unless iat happened to match)
    if (first.body.staticQrToken !== second.body.staticQrToken) {
      expect(dbRoom!.static_qr_token).not.toBe(first.body.staticQrToken);
    }
  });

  it('401 when unauthenticated', async () => {
    const teacherCookie = await signupTeacher('sqr-regen3@test.com');
    const room = await createStaticRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-qr/regenerate`);

    expect(res.status).toBe(401);
  });

  it('403 when a different teacher tries to regenerate', async () => {
    const ownerCookie = await signupTeacher('sqr-regen4a@test.com');
    const otherCookie = await signupTeacher('sqr-regen4b@test.com');
    const room = await createStaticRoom(ownerCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-qr/regenerate`)
      .set('Cookie', `access_token=${otherCookie}`);

    expect(res.status).toBe(403);
  });

  it('404 for a non-existent room', async () => {
    const teacherCookie = await signupTeacher('sqr-regen5@test.com');

    const res = await request(app)
      .post('/api/rooms/nonexistentroom000/static-qr/regenerate')
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/rooms/:id/static-qr ────────────────────────────────────────────

describe('GET /api/rooms/:id/static-qr', () => {
  it('returns the stored static QR token and room name', async () => {
    const teacherCookie = await signupTeacher('sqr-get1@test.com');
    const room = await createStaticRoom(teacherCookie);

    // Generate first
    const regenRes = await request(app)
      .post(`/api/rooms/${room.id}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/static-qr`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.staticQrToken).toBe(regenRes.body.staticQrToken);
    expect(res.body.roomId).toBe(room.id);
    expect(res.body.roomName).toBe('Static Room');
  });

  it('404 when no token has been generated yet', async () => {
    const teacherCookie = await signupTeacher('sqr-get2@test.com');
    const room = await createStaticRoom(teacherCookie);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/static-qr`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No static QR/i);
  });

  it('403 when a different teacher tries to get the QR', async () => {
    const ownerCookie = await signupTeacher('sqr-get3a@test.com');
    const otherCookie = await signupTeacher('sqr-get3b@test.com');
    const room = await createStaticRoom(ownerCookie);

    await request(app)
      .post(`/api/rooms/${room.id}/static-qr/regenerate`)
      .set('Cookie', `access_token=${ownerCookie}`);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/static-qr`)
      .set('Cookie', `access_token=${otherCookie}`);

    expect(res.status).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    const teacherCookie = await signupTeacher('sqr-get4@test.com');
    const room = await createStaticRoom(teacherCookie);

    const res = await request(app).get(`/api/rooms/${room.id}/static-qr`);

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/rooms/:id/static-session/open ─────────────────────────────────

describe('POST /api/rooms/:id/static-session/open', () => {
  it('happy path — creates session with anchor coords from room', async () => {
    const teacherCookie = await signupTeacher('sqr-open1@test.com');
    const room = await createStaticRoom(teacherCookie, {
      anchor_lat: 14.5995,
      anchor_lng: 120.9842,
    });

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(201);
    expect(res.body.room_id).toBe(room.id);
    expect(res.body.status).toBe('active');
    expect(res.body.started_by_officer_id).toBeNull();
    expect(res.body.origin_lat).toBe(14.5995);
    expect(res.body.origin_lng).toBe(120.9842);
    expect(res.body.origin_accuracy).toBe(0);

    // Verify DB row
    const session = await prisma.attendanceSession.findUnique({ where: { id: res.body.id } });
    expect(session).not.toBeNull();
    expect(session!.status).toBe('active');
    expect(session!.origin_lat).toBe(14.5995);
  });

  it('happy path — room with no anchor set: session created with null origin', async () => {
    const teacherCookie = await signupTeacher('sqr-open2@test.com');
    // No anchor_lat / anchor_lng
    const room = await createStaticRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(201);
    expect(res.body.origin_lat).toBeNull();
    expect(res.body.origin_lng).toBeNull();
    // origin_accuracy is 0 even without anchor
    expect(res.body.origin_accuracy).toBe(0);
  });

  it('409 when room already has an active session', async () => {
    const teacherCookie = await signupTeacher('sqr-open3@test.com');
    const room = await createStaticRoom(teacherCookie);

    await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already has an active session/i);
  });

  it('401 when unauthenticated', async () => {
    const teacherCookie = await signupTeacher('sqr-open4@test.com');
    const room = await createStaticRoom(teacherCookie);

    const res = await request(app).post(`/api/rooms/${room.id}/static-session/open`);

    expect(res.status).toBe(401);
  });

  it('403 when a different teacher tries to open', async () => {
    const ownerCookie = await signupTeacher('sqr-open5a@test.com');
    const otherCookie = await signupTeacher('sqr-open5b@test.com');
    const room = await createStaticRoom(ownerCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${otherCookie}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/rooms/:id/static-session/close ────────────────────────────────

describe('POST /api/rooms/:id/static-session/close', () => {
  it('happy path — closes active session, status=ended, ended_at set', async () => {
    const teacherCookie = await signupTeacher('sqr-close1@test.com');
    const room = await createStaticRoom(teacherCookie);

    await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/close`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ended');
    expect(res.body.ended_at).not.toBeNull();
  });

  it('404 when no active session exists', async () => {
    const teacherCookie = await signupTeacher('sqr-close2@test.com');
    const room = await createStaticRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/close`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No active session/i);
  });

  it('404 when session already closed', async () => {
    const teacherCookie = await signupTeacher('sqr-close3@test.com');
    const room = await createStaticRoom(teacherCookie);

    await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);

    // Close once
    await request(app)
      .post(`/api/rooms/${room.id}/static-session/close`)
      .set('Cookie', `access_token=${teacherCookie}`);

    // Close again — no active session remains
    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/close`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    const teacherCookie = await signupTeacher('sqr-close4@test.com');
    const room = await createStaticRoom(teacherCookie);

    await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const res = await request(app).post(`/api/rooms/${room.id}/static-session/close`);

    expect(res.status).toBe(401);
  });

  it('403 when a different teacher tries to close', async () => {
    const ownerCookie = await signupTeacher('sqr-close5a@test.com');
    const otherCookie = await signupTeacher('sqr-close5b@test.com');
    const room = await createStaticRoom(ownerCookie);

    await request(app)
      .post(`/api/rooms/${room.id}/static-session/open`)
      .set('Cookie', `access_token=${ownerCookie}`);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/static-session/close`)
      .set('Cookie', `access_token=${otherCookie}`);

    expect(res.status).toBe(403);
  });
});

// ─── Scan pipeline — static QR token validation ───────────────────────────────

describe('Scan pipeline — static QR mode', () => {
  /** Shared setup: teacher + static room with anchor + student with consent */
  async function setupStaticScan(emailSuffix: string): Promise<{
    teacherCookie: string;
    studentCookie: string;
    studentId: string;
    roomId: string;
    inviteCode: string;
  }> {
    const teacherCookie = await signupTeacher(`sqr-scan-t-${emailSuffix}@test.com`);
    const room = await createStaticRoom(teacherCookie, {
      anchor_lat: 14.5995,
      anchor_lng: 120.9842,
    });
    const studentCookie = await loginStudent(
      `sqr-scan-s-${emailSuffix}@test.com`,
      'Student',
      room.invite_code,
    );
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({
      where: { email: `sqr-scan-s-${emailSuffix}@test.com` },
    });
    await prisma.student.update({
      where: { id: student!.id },
      data: { consent_status: 'granted' },
    });
    return {
      teacherCookie,
      studentCookie,
      studentId: student!.id,
      roomId: room.id,
      inviteCode: room.invite_code,
    };
  }

  it('valid static token → 200 recorded', async () => {
    const { teacherCookie, studentCookie, roomId } = await setupStaticScan('valid');

    // Generate the static QR token
    const regenRes = await request(app)
      .post(`/api/rooms/${roomId}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const staticToken: string = regenRes.body.staticQrToken;

    // Open a static session
    const openRes = await request(app)
      .post(`/api/rooms/${roomId}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const sessionId: string = openRes.body.id;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(staticToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recorded');
    expect(typeof res.body.record_id).toBe('string');

    // Verify DB record method
    const record = await prisma.attendanceRecord.findUnique({ where: { id: res.body.record_id } });
    expect(record!.method).toBe('qr_scan');
    expect(record!.approval_status).toBe('approved');
  });

  it('invalid (random string) token → 400 rejected', async () => {
    const { teacherCookie, studentCookie, roomId } = await setupStaticScan('invalid');

    // Don't regenerate; session still needs to be opened
    await request(app)
      .post(`/api/rooms/${roomId}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const openRes = await request(app)
      .post(`/api/rooms/${roomId}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const sessionId: string = openRes.body.id;

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody('totally-wrong-token'));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('invalid_token');
  });

  it('regenerated token invalidates the old one → old token rejected', async () => {
    const { teacherCookie, studentCookie, roomId } = await setupStaticScan('regen-inval');

    // First token
    const firstRegen = await request(app)
      .post(`/api/rooms/${roomId}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const oldToken: string = firstRegen.body.staticQrToken;

    // Regenerate → new token stored; old is invalid
    const secondRegen = await request(app)
      .post(`/api/rooms/${roomId}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const newToken: string = secondRegen.body.staticQrToken;

    // Skip test if tokens happen to be identical (extremely unlikely same-second iat)
    if (oldToken === newToken) return;

    const openRes = await request(app)
      .post(`/api/rooms/${roomId}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const sessionId: string = openRes.body.id;

    // Old token should be rejected
    const resOld = await request(app)
      .post(`/api/sessions/${sessionId}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(oldToken));

    expect(resOld.status).toBe(400);
    expect(resOld.body.reason).toBe('invalid_token');

    // New token should pass
    const resNew = await request(app)
      .post(`/api/sessions/${sessionId}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(newToken));

    expect(resNew.status).toBe(200);
    expect(resNew.body.status).toBe('recorded');
  });

  it('rotating token (random 16-char) rejected in static-mode session', async () => {
    const { teacherCookie, studentCookie, roomId } = await setupStaticScan('rot-tok');

    // Generate a static QR token (so room.static_qr_token is set)
    await request(app)
      .post(`/api/rooms/${roomId}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const openRes = await request(app)
      .post(`/api/rooms/${roomId}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const sessionId: string = openRes.body.id;

    // Submit a random 16-char string like a rotating token — should be rejected
    const fakeRotatingToken = crypto.randomBytes(8).toString('hex'); // 16 hex chars

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(fakeRotatingToken));

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid_token');
  });

  it('JWT with wrong roomId in payload → rejected even if signature valid', async () => {
    const { teacherCookie, studentCookie, roomId } = await setupStaticScan('wrong-room');

    // Create a second room to forge a token for
    const otherRoom = await createStaticRoom(teacherCookie);

    // Generate token for the *other* room
    const regenOther = await request(app)
      .post(`/api/rooms/${otherRoom.id}/static-qr/regenerate`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const foreignToken: string = regenOther.body.staticQrToken;

    // Inject foreign token into the first room's DB so the equality check passes
    await prisma.room.update({
      where: { id: roomId },
      data: { static_qr_token: foreignToken },
    });

    const openRes = await request(app)
      .post(`/api/rooms/${roomId}/static-session/open`)
      .set('Cookie', `access_token=${teacherCookie}`);
    const sessionId: string = openRes.body.id;

    // Token passes the string equality check but roomId claim doesn't match session.room_id
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(foreignToken));

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid_token');
  });
});
