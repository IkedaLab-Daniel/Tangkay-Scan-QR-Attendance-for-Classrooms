import * as ipGeoModule from '../lib/ipGeo';

import request from 'supertest';
import crypto from 'crypto';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import redis from '../lib/redis';
import * as tokenRotator from '../lib/tokenRotator';
import { haversineMetres, pickRepresentativeReading } from '../lib/geo';

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

async function createRoom(
  teacherCookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; invite_code: string }> {
  const res = await request(app)
    .post('/api/rooms')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ name: 'Scan Test Room', attendance_mode: 'balanced', ...overrides });
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

async function startSession(
  teacherCookie: string,
  roomId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; token: string }> {
  const res = await request(app)
    .post('/api/sessions')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ roomId, ...extra });
  return res.body as { id: string; token: string };
}

/** Minimal in-range reading for a classroom origin at (14.5995, 120.9842) */
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
    device_fingerprint: 'fp-test-001',
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

// ─── geo.ts unit tests ────────────────────────────────────────────────────────

describe('haversineMetres', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMetres(14.5995, 120.9842, 14.5995, 120.9842)).toBe(0);
  });

  it('returns approximately 111 195 m for 1 degree of latitude', () => {
    const d = haversineMetres(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });

  it('returns approximately 111 319 m for 1 degree of longitude at equator', () => {
    const d = haversineMetres(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });

  it('returns known distance — Manila to Makati (~6 km)', () => {
    // Manila City Hall to Makati City Hall — rough coordinates
    const d = haversineMetres(14.5928, 120.9826, 14.5548, 121.0244);
    expect(d).toBeGreaterThan(4_000);
    expect(d).toBeLessThan(7_000);
  });

  it('is symmetric', () => {
    const a = haversineMetres(14.5995, 120.9842, 14.6005, 120.985);
    const b = haversineMetres(14.6005, 120.985, 14.5995, 120.9842);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });
});

describe('pickRepresentativeReading', () => {
  it('returns null for empty array', () => {
    expect(pickRepresentativeReading([])).toBeNull();
  });

  it('returns the single element when array has one entry', () => {
    const r = makeReading({ accuracy: 10 });
    expect(pickRepresentativeReading([r])).toBe(r);
  });

  it('picks the reading with the lowest accuracy value', () => {
    const r1 = makeReading({ accuracy: 20 });
    const r2 = makeReading({ accuracy: 5 });
    const r3 = makeReading({ accuracy: 15 });
    expect(pickRepresentativeReading([r1, r2, r3])).toBe(r2);
  });

  it('returns the first of two equal-accuracy readings (stable reduce)', () => {
    const r1 = makeReading({ accuracy: 5 });
    const r2 = makeReading({ accuracy: 5 });
    expect(pickRepresentativeReading([r1, r2])).toBe(r1);
  });
});

// ─── POST /api/sessions/:id/scan — integration tests ─────────────────────────

describe('POST /api/sessions/:id/scan', () => {
  it('happy path — valid token, in-range GPS → 200 recorded', async () => {
    const teacherCookie = await signupTeacher('scan-happy@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-happy@test.com', 'Alice', room.invite_code);
    await joinRoom(room.id, studentCookie);
    // Grant consent directly in DB
    const student = await prisma.student.findFirst({ where: { email: 's-happy@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id, {
      originLat: 14.5995,
      originLng: 120.9842,
      originAccuracy: 5,
    });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recorded');
    expect(typeof res.body.record_id).toBe('string');

    // Verify DB row
    const record = await prisma.attendanceRecord.findUnique({ where: { id: res.body.record_id } });
    expect(record).not.toBeNull();
    expect(record!.method).toBe('qr_scan');
    expect(record!.approval_status).toBe('approved');
    expect(record!.risk_score).toBe('low');
    expect(record!.device_fingerprint).toBe('fp-test-001');
  });

  it('already recorded — second identical scan returns 200 already_recorded', async () => {
    const teacherCookie = await signupTeacher('scan-idem@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-idem@test.com', 'Bob', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-idem@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);

    const body = makeScanBody(session.token, []); // empty readings — warn policy passes

    const first = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('recorded');

    // Clear rate-limit key so the second request isn't throttled
    await redis.del(`scan_rate:${session.id}:${student!.id}`);

    const second = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('already_recorded');
  });

  it('invalid token → 400 rejected', async () => {
    const teacherCookie = await signupTeacher('scan-badtok@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-badtok@test.com', 'Carol', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-badtok@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody('WRONG-TOKEN-XYZ'));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('invalid_token');
  });

  it('session closed → 400 rejected', async () => {
    const teacherCookie = await signupTeacher('scan-closed@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-closed@test.com', 'Dave', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-closed@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);

    // End the session
    await request(app)
      .post(`/api/sessions/${session.id}/end`)
      .set('Cookie', `access_token=${teacherCookie}`);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('session_closed');
  });

  it('no consent — student consent pending → 400 rejected', async () => {
    const teacherCookie = await signupTeacher('scan-noconsent@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-noconsent@test.com', 'Eve', room.invite_code);
    await joinRoom(room.id, studentCookie);
    // Do NOT grant consent — default is 'pending'

    const session = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('consent_not_granted');
  });

  it('empty readings + gps_policy=warn → 200 recorded with location_flag=unverified', async () => {
    const teacherCookie = await signupTeacher('scan-warn-empty@test.com');
    // balanced mode → gps_policy defaults to warn via modePresets
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-warn-empty@test.com', 'Frank', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-warn-empty@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token, []));

    expect(res.status).toBe(200);
    expect(['recorded', 'flagged']).toContain(res.body.status);

    const record = await prisma.attendanceRecord.findUnique({ where: { id: res.body.record_id } });
    expect(record!.location_flag).toBe('unverified');
  });

  it('empty readings + gps_policy=reject → 400 rejected', async () => {
    const teacherCookie = await signupTeacher('scan-reject-empty@test.com');
    // strict mode → gps_policy=reject; override selfie_policy so this test focuses on GPS
    const room = await createRoom(teacherCookie, { attendance_mode: 'strict', selfie_policy: 'optional' });
    const studentCookie = await loginStudent(
      's-reject-empty@test.com',
      'Grace',
      room.invite_code,
    );
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-reject-empty@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id, {
      originLat: 14.5995,
      originLng: 120.9842,
      originAccuracy: 5,
    });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token, []));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('no_gps_readings');
  });

  it('out-of-geofence + gps_policy=warn → 200 flagged', async () => {
    const teacherCookie = await signupTeacher('scan-warn-geo@test.com');
    const room = await createRoom(teacherCookie); // balanced → gps_policy=warn
    const studentCookie = await loginStudent('s-warn-geo@test.com', 'Hank', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-warn-geo@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    // Origin set to Manila; student reading is far away (Cebu ~580 km)
    const session = await startSession(teacherCookie, room.id, {
      originLat: 14.5995,
      originLng: 120.9842,
      originAccuracy: 5,
    });

    const farReading = makeReading({ lat: 10.3157, lng: 123.8854, accuracy: 5 }); // Cebu

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token, [farReading]));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');

    const record = await prisma.attendanceRecord.findUnique({ where: { id: res.body.record_id } });
    expect(record!.location_flag).toBe('mismatch');
  });

  it('out-of-geofence + gps_policy=reject → 400 rejected', async () => {
    const teacherCookie = await signupTeacher('scan-reject-geo@test.com');
    // strict mode → gps_policy=reject; override selfie_policy so this test focuses on GPS
    const room = await createRoom(teacherCookie, { attendance_mode: 'strict', selfie_policy: 'optional' });
    const studentCookie = await loginStudent('s-reject-geo@test.com', 'Iris', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-reject-geo@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id, {
      originLat: 14.5995,
      originLng: 120.9842,
      originAccuracy: 5,
    });

    const farReading = makeReading({ lat: 10.3157, lng: 123.8854, accuracy: 5 }); // Cebu

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token, [farReading]));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('outside_geofence');
  });

  it('401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/sessions/some-id/scan')
      .send(makeScanBody('tok'));
    expect(res.status).toBe(401);
  });

  it('400 on malformed payload — lat out of bounds', async () => {
    const teacherCookie = await signupTeacher('scan-bad-payload@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-bad-payload@test.com', 'Jay', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-bad-payload@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token, [makeReading({ lat: 200 })])); // invalid lat

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('400 on timestamp spread > 10 000 ms', async () => {
    const teacherCookie = await signupTeacher('scan-spread@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-spread@test.com', 'Kim', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-spread@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);
    const now = Date.now();

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(
        makeScanBody(session.token, [
          makeReading({ timestamp: now }),
          makeReading({ timestamp: now + 11_000 }), // 11 s spread
        ]),
      );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rate-limit — second immediate scan returns 429', async () => {
    const teacherCookie = await signupTeacher('scan-rate@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-rate@test.com', 'Leo', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-rate@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);

    const first = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token, []));
    expect(first.status).toBe(200);

    // Immediately retry — rate-limit key is live
    const second = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody(session.token, []));
    expect(second.status).toBe(429);
  });

  it('404 for non-existent session', async () => {
    const teacherCookie = await signupTeacher('scan-nosession@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent('s-nosession@test.com', 'Mia', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-nosession@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const res = await request(app)
      .post('/api/sessions/nonexistent-id-000/scan')
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeScanBody('anytoken', []));

    expect(res.status).toBe(404);
  });
});

// ─── Selfie policy integration tests ─────────────────────────────────────────

/** Generate a minimal 10×10 red JPEG in-memory using sharp */
async function makeJpegBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** Build multipart scan fields for supertest */
function makeScanFields(token: string, readingsOverride?: unknown[]) {
  return {
    token,
    readings: JSON.stringify(readingsOverride ?? [makeReading()]),
    client_time: String(Date.now()),
    device_fingerprint: 'fp-multipart-001',
  };
}

describe('POST /api/sessions/:id/scan — selfie policy', () => {
  it('selfie_policy=required + no selfie → 400 selfie_required', async () => {
    const teacherCookie = await signupTeacher('scan-selfie-req@test.com');
    const room = await createRoom(teacherCookie, { selfie_policy: 'required' });
    const studentCookie = await loginStudent('s-selfie-req@test.com', 'Sam', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-selfie-req@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);
    const fields = makeScanFields(session.token, []);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .field('token', fields.token)
      .field('readings', fields.readings)
      .field('client_time', fields.client_time)
      .field('device_fingerprint', fields.device_fingerprint);

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('selfie_required');
  });

  it('selfie_policy=required + selfie file → 200 recorded, selfie_url set', async () => {
    const teacherCookie = await signupTeacher('scan-selfie-ok@test.com');
    const room = await createRoom(teacherCookie, { selfie_policy: 'required' });
    const studentCookie = await loginStudent('s-selfie-ok@test.com', 'Pat', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-selfie-ok@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);
    const fields = makeScanFields(session.token, []);
    const jpegBuf = await makeJpegBuffer();

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .field('token', fields.token)
      .field('readings', fields.readings)
      .field('client_time', fields.client_time)
      .field('device_fingerprint', fields.device_fingerprint)
      .attach('selfie', jpegBuf, { filename: 'selfie.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recorded');
    expect(typeof res.body.record_id).toBe('string');
    expect(res.body.selfie_url).toMatch(/uploads\/selfies\/.+\.webp$/);

    // Confirm selfie_url is persisted in DB
    const record = await prisma.attendanceRecord.findUnique({ where: { id: res.body.record_id } });
    expect(record!.selfie_url).toMatch(/uploads\/selfies\/.+\.webp$/);
  });

  it('selfie_policy=optional + no selfie → 200 recorded, selfie_url null', async () => {
    const teacherCookie = await signupTeacher('scan-selfie-opt@test.com');
    const room = await createRoom(teacherCookie, { selfie_policy: 'optional' });
    const studentCookie = await loginStudent('s-selfie-opt@test.com', 'Quinn', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-selfie-opt@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);
    const fields = makeScanFields(session.token, []);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .field('token', fields.token)
      .field('readings', fields.readings)
      .field('client_time', fields.client_time)
      .field('device_fingerprint', fields.device_fingerprint);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recorded');
    expect(res.body.selfie_url).toBeNull();

    const record = await prisma.attendanceRecord.findUnique({ where: { id: res.body.record_id } });
    expect(record!.selfie_url).toBeNull();
  });

  it('selfie_policy=off + selfie file uploaded → selfie ignored, selfie_url null', async () => {
    const teacherCookie = await signupTeacher('scan-selfie-off@test.com');
    const room = await createRoom(teacherCookie, { selfie_policy: 'off' });
    const studentCookie = await loginStudent('s-selfie-off@test.com', 'Riley', room.invite_code);
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({ where: { email: 's-selfie-off@test.com' } });
    await prisma.student.update({ where: { id: student!.id }, data: { consent_status: 'granted' } });

    const session = await startSession(teacherCookie, room.id);
    const fields = makeScanFields(session.token, []);
    const jpegBuf = await makeJpegBuffer();

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .field('token', fields.token)
      .field('readings', fields.readings)
      .field('client_time', fields.client_time)
      .field('device_fingerprint', fields.device_fingerprint)
      .attach('selfie', jpegBuf, { filename: 'selfie.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.selfie_url).toBeNull();
  });
});


// ─── Risk signal scoring integration tests ────────────────────────────────────

describe('POST /api/sessions/:id/scan — risk scoring', () => {
  beforeEach(() => {
    // Never call real IP geo in integration tests
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * 4-signal high-risk reading set:
   *  - identical_coords (all same lat/lng, ≥2 readings)
   *  - constant_accuracy (all same accuracy value)
   *  - all_null_sensors (altitude/speed/heading all null)
   *  - clock_delta (client_time 5 min in the past)
   */
  function makeHighRiskBody(token: string) {
    const now = Date.now();
    const reading = {
      lat: 14.5995,
      lng: 120.9842,
      accuracy: 5,
      altitude: null,
      speed: null,
      heading: null,
      timestamp: now,
    };
    return {
      token,
      readings: [reading, { ...reading }],
      client_time: now - 5 * 60 * 1000, // 5-min drift → clock_delta
      device_fingerprint: 'fp-risk-high',
    };
  }

  /**
   * 2-signal medium-risk reading set:
   *  - identical_coords
   *  - constant_accuracy
   *  (sensors are present → all_null_sensors does NOT fire; clock is in-sync → no clock_delta)
   */
  function makeMediumRiskBody(token: string) {
    const now = Date.now();
    const reading = {
      lat: 14.5995,
      lng: 120.9842,
      accuracy: 5,
      altitude: 10,   // sensor present → all_null_sensors won't fire
      speed: 0,
      heading: 90,
      timestamp: now,
    };
    return {
      token,
      readings: [reading, { ...reading }],
      client_time: now, // in-sync → no clock_delta
      device_fingerprint: 'fp-risk-med',
    };
  }

  it('strict mode + 4-signal high risk → 400 rejected', async () => {
    const teacherCookie = await signupTeacher('scan-risk-strict-high@test.com');
    // strict mode, override selfie so this focuses on risk only
    const room = await createRoom(teacherCookie, {
      attendance_mode: 'strict',
      selfie_policy: 'optional',
    });
    const studentCookie = await loginStudent(
      's-risk-strict-high@test.com',
      'RiskHigh',
      room.invite_code,
    );
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({
      where: { email: 's-risk-strict-high@test.com' },
    });
    await prisma.student.update({
      where: { id: student!.id },
      data: { consent_status: 'granted' },
    });

    const session = await startSession(teacherCookie, room.id, {
      originLat: 14.5995,
      originLng: 120.9842,
      originAccuracy: 5,
    });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeHighRiskBody(session.token));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('high_risk');
  });

  it('strict mode + 2-signal medium risk → 200 flagged', async () => {
    const teacherCookie = await signupTeacher('scan-risk-strict-med@test.com');
    const room = await createRoom(teacherCookie, {
      attendance_mode: 'strict',
      selfie_policy: 'optional',
    });
    const studentCookie = await loginStudent(
      's-risk-strict-med@test.com',
      'RiskMed',
      room.invite_code,
    );
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({
      where: { email: 's-risk-strict-med@test.com' },
    });
    await prisma.student.update({
      where: { id: student!.id },
      data: { consent_status: 'granted' },
    });

    const session = await startSession(teacherCookie, room.id, {
      originLat: 14.5995,
      originLng: 120.9842,
      originAccuracy: 5,
    });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeMediumRiskBody(session.token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');

    const record = await prisma.attendanceRecord.findUnique({
      where: { id: res.body.record_id },
    });
    expect(record!.risk_score).toBe('medium');
  });

  it('balanced mode + high risk → 200 flagged (not rejected)', async () => {
    const teacherCookie = await signupTeacher('scan-risk-balanced-high@test.com');
    // balanced mode — default
    const room = await createRoom(teacherCookie, { attendance_mode: 'balanced' });
    const studentCookie = await loginStudent(
      's-risk-balanced-high@test.com',
      'RiskBalanced',
      room.invite_code,
    );
    await joinRoom(room.id, studentCookie);
    const student = await prisma.student.findFirst({
      where: { email: 's-risk-balanced-high@test.com' },
    });
    await prisma.student.update({
      where: { id: student!.id },
      data: { consent_status: 'granted' },
    });

    const session = await startSession(teacherCookie, room.id, {
      originLat: 14.5995,
      originLng: 120.9842,
      originAccuracy: 5,
    });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/scan`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send(makeHighRiskBody(session.token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');

    const record = await prisma.attendanceRecord.findUnique({
      where: { id: res.body.record_id },
    });
    expect(record!.risk_score).toBe('high');
  });
});
