import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../index';

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

async function signupTeacher(
  email: string,
  name = 'Teacher',
): Promise<{ accessCookie: string }> {
  const res = await request(app)
    .post('/api/auth/teacher/signup')
    .send({ name, email, password: 'password123' });
  const cookies = parseCookies(res);
  return { accessCookie: cookies['access_token'] };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await prisma.room.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.teacher.deleteMany();
});

afterAll(async () => {
  await prisma.room.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.$disconnect();
});

// ─── POST /api/rooms ──────────────────────────────────────────────────────────

describe('POST /api/rooms', () => {
  it('happy path — creates room with invite_code and mode presets applied', async () => {
    const { accessCookie } = await signupTeacher('t1@test.com');

    const res = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ name: 'Math 101', attendance_mode: 'strict' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Math 101');
    expect(res.body.attendance_mode).toBe('strict');

    // invite_code must be 8 URL-safe chars
    expect(res.body.invite_code).toMatch(/^[A-Za-z0-9_-]{8}$/);

    // strict preset: rotating QR, reject GPS, required selfie
    expect(res.body.qr_type).toBe('rotating');
    expect(res.body.gps_policy).toBe('reject');
    expect(res.body.selfie_policy).toBe('required');

    // defaults
    expect(res.body.geofence_radius_m).toBe(100);
    expect(res.body.require_manual_approval).toBe(true);
  });

  it('applies balanced preset correctly', async () => {
    const { accessCookie } = await signupTeacher('t1b@test.com');
    const res = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ name: 'Science', attendance_mode: 'balanced' });

    expect(res.status).toBe(201);
    expect(res.body.qr_type).toBe('rotating');
    expect(res.body.gps_policy).toBe('warn');
    expect(res.body.selfie_policy).toBe('optional');
  });

  it('applies static preset correctly', async () => {
    const { accessCookie } = await signupTeacher('t1c@test.com');
    const res = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ name: 'History', attendance_mode: 'static' });

    expect(res.status).toBe(201);
    expect(res.body.qr_type).toBe('static');
    expect(res.body.gps_policy).toBe('warn');
    expect(res.body.selfie_policy).toBe('optional');
  });

  it('applies manual preset correctly', async () => {
    const { accessCookie } = await signupTeacher('t1d@test.com');
    const res = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ name: 'PE', attendance_mode: 'manual' });

    expect(res.status).toBe(201);
    expect(res.body.qr_type).toBe('static');
    expect(res.body.gps_policy).toBe('off');
    expect(res.body.selfie_policy).toBe('off');
  });

  it('missing name returns 400', async () => {
    const { accessCookie } = await signupTeacher('t2@test.com');
    const res = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ attendance_mode: 'strict' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('unauthenticated returns 401', async () => {
    const res = await request(app)
      .post('/api/rooms')
      .send({ name: 'Math 101', attendance_mode: 'strict' });

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/rooms ───────────────────────────────────────────────────────────

describe('GET /api/rooms', () => {
  it('returns only rooms belonging to the requesting teacher', async () => {
    const { accessCookie: cookieA } = await signupTeacher('ta@test.com', 'Alice');
    const { accessCookie: cookieB } = await signupTeacher('tb@test.com', 'Bob');

    // Alice creates 2 rooms
    await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${cookieA}`)
      .send({ name: 'Alice Room 1', attendance_mode: 'strict' });
    await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${cookieA}`)
      .send({ name: 'Alice Room 2', attendance_mode: 'manual' });

    // Bob creates 1 room
    await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${cookieB}`)
      .send({ name: 'Bob Room', attendance_mode: 'balanced' });

    const resA = await request(app)
      .get('/api/rooms')
      .set('Cookie', `access_token=${cookieA}`);

    expect(resA.status).toBe(200);
    expect(resA.body).toHaveLength(2);
    expect(resA.body.map((r: { name: string }) => r.name).sort()).toEqual(
      ['Alice Room 1', 'Alice Room 2'].sort(),
    );

    const resB = await request(app)
      .get('/api/rooms')
      .set('Cookie', `access_token=${cookieB}`);

    expect(resB.status).toBe(200);
    expect(resB.body).toHaveLength(1);
    expect(resB.body[0].name).toBe('Bob Room');
  });
});

// ─── GET /api/rooms/:id ───────────────────────────────────────────────────────

describe('GET /api/rooms/:id', () => {
  it('returns room when found and belongs to teacher', async () => {
    const { accessCookie } = await signupTeacher('tc@test.com');
    const createRes = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ name: 'Room X', attendance_mode: 'balanced' });

    const roomId = createRes.body.id;
    const res = await request(app)
      .get(`/api/rooms/${roomId}`)
      .set('Cookie', `access_token=${accessCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(roomId);
    expect(res.body.name).toBe('Room X');
  });

  it('returns 404 for non-existent room', async () => {
    const { accessCookie } = await signupTeacher('td@test.com');
    const res = await request(app)
      .get('/api/rooms/nonexistentid000')
      .set('Cookie', `access_token=${accessCookie}`);

    expect(res.status).toBe(404);
  });

  it('returns 403 when room belongs to a different teacher', async () => {
    const { accessCookie: cookieA } = await signupTeacher('te1@test.com', 'Eve1');
    const { accessCookie: cookieB } = await signupTeacher('te2@test.com', 'Eve2');

    const createRes = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${cookieA}`)
      .send({ name: 'Eve Room', attendance_mode: 'strict' });

    const roomId = createRes.body.id;
    const res = await request(app)
      .get(`/api/rooms/${roomId}`)
      .set('Cookie', `access_token=${cookieB}`);

    expect(res.status).toBe(403);
  });
});

// ─── PATCH /api/rooms/:id ─────────────────────────────────────────────────────

describe('PATCH /api/rooms/:id', () => {
  it('changing mode re-applies preset defaults', async () => {
    const { accessCookie } = await signupTeacher('tf@test.com');
    const createRes = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ name: 'Physics', attendance_mode: 'strict' });

    const roomId = createRes.body.id;

    const res = await request(app)
      .patch(`/api/rooms/${roomId}`)
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ attendance_mode: 'manual' });

    expect(res.status).toBe(200);
    expect(res.body.attendance_mode).toBe('manual');
    expect(res.body.qr_type).toBe('static');
    expect(res.body.gps_policy).toBe('off');
    expect(res.body.selfie_policy).toBe('off');
  });

  it('explicit override in same request as mode change wins over preset', async () => {
    const { accessCookie } = await signupTeacher('tg@test.com');
    const createRes = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ name: 'Chemistry', attendance_mode: 'strict' });

    const roomId = createRes.body.id;

    // Switch to balanced (preset: gps=warn, selfie=optional)
    // but explicitly override selfie_policy to 'required'
    const res = await request(app)
      .patch(`/api/rooms/${roomId}`)
      .set('Cookie', `access_token=${accessCookie}`)
      .send({ attendance_mode: 'balanced', selfie_policy: 'required' });

    expect(res.status).toBe(200);
    expect(res.body.attendance_mode).toBe('balanced');
    expect(res.body.gps_policy).toBe('warn');       // preset default
    expect(res.body.selfie_policy).toBe('required'); // explicit override wins
  });

  it('returns 403 when room belongs to a different teacher', async () => {
    const { accessCookie: cookieA } = await signupTeacher('th1@test.com', 'Teacher1');
    const { accessCookie: cookieB } = await signupTeacher('th2@test.com', 'Teacher2');

    const createRes = await request(app)
      .post('/api/rooms')
      .set('Cookie', `access_token=${cookieA}`)
      .send({ name: 'Shared Room', attendance_mode: 'balanced' });

    const roomId = createRes.body.id;
    const res = await request(app)
      .patch(`/api/rooms/${roomId}`)
      .set('Cookie', `access_token=${cookieB}`)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
  });
});
