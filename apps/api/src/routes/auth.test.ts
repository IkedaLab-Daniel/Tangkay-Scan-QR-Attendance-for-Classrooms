import request from 'supertest';
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

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.teacher.deleteMany();
  // Clear rate-limit keys from Redis
  const keys = await redis.keys('login:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.$disconnect();
  redis.disconnect();
});

// ─── Signup ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/teacher/signup', () => {
  it('happy path — creates teacher and sets cookies', async () => {
    const res = await request(app)
      .post('/api/auth/teacher/signup')
      .send({ name: 'Alice', email: 'alice@test.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Alice', email: 'alice@test.com' });
    expect(res.body.id).toBeDefined();

    const cookies = parseCookies(res);
    expect(cookies['access_token']).toBeDefined();
    expect(cookies['refresh_token']).toBeDefined();
  });

  it('duplicate email returns 409', async () => {
    const payload = { name: 'Bob', email: 'bob@test.com', password: 'password123' };
    await request(app).post('/api/auth/teacher/signup').send(payload);
    const res = await request(app).post('/api/auth/teacher/signup').send(payload);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already registered');
  });

  it('invalid body returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/teacher/signup')
      .send({ name: 'X', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/teacher/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/auth/teacher/signup')
      .send({ name: 'Carol', email: 'carol@test.com', password: 'password123' });
  });

  it('happy path — sets cookies with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/teacher/login')
      .send({ email: 'carol@test.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'carol@test.com' });

    const cookies = parseCookies(res);
    expect(cookies['access_token']).toBeDefined();
    expect(cookies['refresh_token']).toBeDefined();
  });

  it('wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/teacher/login')
      .send({ email: 'carol@test.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('unknown email returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/teacher/login')
      .send({ email: 'nobody@test.com', password: 'password123' });
    expect(res.status).toBe(401);
  });
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

describe('POST /api/auth/teacher/refresh', () => {
  it('issues new access token from valid refresh cookie', async () => {
    // Sign up to get cookies
    const signupRes = await request(app)
      .post('/api/auth/teacher/signup')
      .send({ name: 'Dave', email: 'dave@test.com', password: 'password123' });

    const cookies = parseCookies(signupRes);
    const refreshToken = cookies['refresh_token'];

    const res = await request(app)
      .post('/api/auth/teacher/refresh')
      .set('Cookie', `refresh_token=${refreshToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const newCookies = parseCookies(res);
    // A new access token cookie must be set
    expect(newCookies['access_token']).toBeDefined();
    // It must be a valid JWT (3 dot-separated segments)
    expect(newCookies['access_token'].split('.').length).toBe(3);

    // The new access token must be accepted by /api/auth/me
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `access_token=${newCookies['access_token']}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('dave@test.com');
  });

  it('missing refresh cookie returns 401', async () => {
    const res = await request(app).post('/api/auth/teacher/refresh');
    expect(res.status).toBe(401);
  });

  it('invalid refresh token returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/teacher/refresh')
      .set('Cookie', 'refresh_token=totally.invalid.token');
    expect(res.status).toBe(401);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('clears cookies and removes refresh token from DB', async () => {
    const signupRes = await request(app)
      .post('/api/auth/teacher/signup')
      .send({ name: 'Eve', email: 'eve@test.com', password: 'password123' });

    const cookies = parseCookies(signupRes);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [
        `access_token=${cookies['access_token']}`,
        `refresh_token=${cookies['refresh_token']}`,
      ]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Verify refresh token was deleted from DB
    const count = await prisma.refreshToken.count();
    expect(count).toBe(0);
  });

  it('logout without cookie still returns 200', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
  });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns teacher profile with valid access token', async () => {
    const signupRes = await request(app)
      .post('/api/auth/teacher/signup')
      .send({ name: 'Frank', email: 'frank@test.com', password: 'password123' });

    const cookies = parseCookies(signupRes);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `access_token=${cookies['access_token']}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Frank', email: 'frank@test.com' });
    expect(res.body.password_hash).toBeUndefined();
  });

  it('returns 401 without access token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
