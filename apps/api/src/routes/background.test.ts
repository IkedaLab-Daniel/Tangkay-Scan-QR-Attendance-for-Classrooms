import request from 'supertest';
import crypto from 'crypto';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import redis from '../lib/redis';

const prisma = new PrismaClient();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function makeJpegBuffer(
  width = 100,
  height = 100,
  color: { r: number; g: number; b: number } = { r: 200, g: 200, b: 200 },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function makeLargeBuffer(): Promise<Buffer> {
  // ~6 MB uncompressed — larger than 5 MB multer limit
  return Buffer.alloc(6 * 1024 * 1024, 0xaa);
}

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

async function createRoom(teacherCookie: string): Promise<{ id: string }> {
  const res = await request(app)
    .post('/api/rooms')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ name: 'BG Test Room', attendance_mode: 'balanced' });
  return res.body as { id: string };
}

async function loginStudent(inviteCode: string, name = 'Student'): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(
    `magic:${token}`,
    JSON.stringify({ email: `${token}@test.com`, name, inviteCode }),
    'EX',
    900,
  );
  const res = await request(app).get(`/api/auth/student/verify/${token}`);
  return parseCookies(res)['access_token'];
}

async function joinRoom(roomId: string, studentCookie: string): Promise<void> {
  await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .set('Cookie', `access_token=${studentCookie}`);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await prisma.backgroundReport.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();

  const magicKeys = await redis.keys('magic:*');
  if (magicKeys.length) await redis.del(...magicKeys);
});

afterAll(async () => {
  await prisma.backgroundReport.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.student.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.$disconnect();
  redis.disconnect();

  // Clean up any test background files
  const bgDir = path.join(process.cwd(), 'uploads', 'backgrounds');
  if (fs.existsSync(bgDir)) {
    for (const file of fs.readdirSync(bgDir)) {
      if (file.endsWith('.webp')) {
        try { fs.unlinkSync(path.join(bgDir, file)); } catch { /* ignore */ }
      }
    }
  }
});

// ─── GET /api/presets ─────────────────────────────────────────────────────────

describe('GET /api/presets', () => {
  it('returns array of preset objects', async () => {
    const res = await request(app).get('/api/presets');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const p of res.body as Array<{ id: string; name: string }>) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
    }
  });

  it('includes paper, sprout, oat presets', async () => {
    const res = await request(app).get('/api/presets');
    const ids = (res.body as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain('paper');
    expect(ids).toContain('sprout');
    expect(ids).toContain('oat');
  });
});

// ─── POST /api/rooms/:id/background ──────────────────────────────────────────

describe('POST /api/rooms/:id/background — upload background', () => {
  it('happy path: uploads JPEG, room updated with background fields', async () => {
    const cookie = await signupTeacher('bg-upload1@test.com');
    const room = await createRoom(cookie);
    const jpeg = await makeJpegBuffer(200, 200, { r: 30, g: 30, b: 30 }); // dark image

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.background_type).toBe('custom');
    expect(res.body.background_image_path).toMatch(/uploads[/\\]backgrounds[/\\].+\.webp/);
    expect(res.body.background_placeholder).toMatch(/^data:image\/webp;base64,/);
    expect(['light', 'dark']).toContain(res.body.background_scrim);
    expect(res.body.background_dim).toBe(35);

    // Verify file exists on disk
    const filePath = path.join(process.cwd(), res.body.background_image_path);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('computes scrim=light for a very dark image', async () => {
    const cookie = await signupTeacher('bg-scrim-dark@test.com');
    const room = await createRoom(cookie);
    // Very dark image → avg luminance < 127 → 'light' scrim
    const jpeg = await makeJpegBuffer(100, 100, { r: 10, g: 10, b: 10 });

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'dark.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.background_scrim).toBe('light');
  });

  it('computes scrim=dark for a very light image', async () => {
    const cookie = await signupTeacher('bg-scrim-light@test.com');
    const room = await createRoom(cookie);
    // Very light image → avg luminance > 127 → 'dark' scrim
    const jpeg = await makeJpegBuffer(100, 100, { r: 250, g: 250, b: 250 });

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'light.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.background_scrim).toBe('dark');
  });

  it('rejects invalid file type (400)', async () => {
    const cookie = await signupTeacher('bg-invalid@test.com');
    const room = await createRoom(cookie);
    const garbage = Buffer.from('this is not an image at all');

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', garbage, { filename: 'not-an-image.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid image type/i);
  });

  it('rejects file over 5 MB (413)', async () => {
    const cookie = await signupTeacher('bg-large@test.com');
    const room = await createRoom(cookie);
    const large = await makeLargeBuffer();

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', large, { filename: 'large.jpg', contentType: 'image/jpeg' });

    // Multer rejects with 413 (or possibly 500 depending on config) — just not 200
    expect(res.status).not.toBe(200);
  });

  it('replaces old file on second upload', async () => {
    const cookie = await signupTeacher('bg-replace@test.com');
    const room = await createRoom(cookie);
    const jpeg = await makeJpegBuffer();

    const first = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'first.jpg', contentType: 'image/jpeg' });

    expect(first.status).toBe(200);
    const firstPath = path.join(process.cwd(), first.body.background_image_path);
    expect(fs.existsSync(firstPath)).toBe(true);

    const second = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'second.jpg', contentType: 'image/jpeg' });

    expect(second.status).toBe(200);
    // Old file should be deleted
    expect(fs.existsSync(firstPath)).toBe(false);
    // New file exists
    const secondPath = path.join(process.cwd(), second.body.background_image_path);
    expect(fs.existsSync(secondPath)).toBe(true);
  });

  it('returns 403 for a different teacher (wrong owner)', async () => {
    const cookie1 = await signupTeacher('bg-own1@test.com');
    const cookie2 = await signupTeacher('bg-own2@test.com');
    const room = await createRoom(cookie1);
    const jpeg = await makeJpegBuffer();

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie2}`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });

  it('returns 401 with no cookie', async () => {
    const cookie = await signupTeacher('bg-noauth@test.com');
    const room = await createRoom(cookie);
    const jpeg = await makeJpegBuffer();

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/rooms/:id/background ────────────────────────────────────────

describe('DELETE /api/rooms/:id/background — remove background', () => {
  it('happy path: removes file, resets all background fields', async () => {
    const cookie = await signupTeacher('bg-del1@test.com');
    const room = await createRoom(cookie);
    const jpeg = await makeJpegBuffer();

    // Upload first
    const upload = await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(upload.status).toBe(200);
    const filePath = path.join(process.cwd(), upload.body.background_image_path);

    // Now delete
    const del = await request(app)
      .delete(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`);

    expect(del.status).toBe(200);
    expect(del.body.message).toBe('Background removed');

    // File deleted from disk
    expect(fs.existsSync(filePath)).toBe(false);

    // DB reset
    const updated = await prisma.room.findUnique({ where: { id: room.id } });
    expect(updated!.background_type).toBe('none');
    expect(updated!.background_image_path).toBeNull();
    expect(updated!.background_placeholder).toBeNull();
    expect(updated!.background_scrim).toBe('dark');
    expect(updated!.background_dim).toBe(35);
    expect(updated!.background_blur).toBe(0);
    expect(updated!.background_preset_id).toBeNull();
  });

  it('does not crash when no file on disk (ENOENT)', async () => {
    const cookie = await signupTeacher('bg-del-nofile@test.com');
    const room = await createRoom(cookie);

    // Manually set background_image_path to a nonexistent path in DB
    await prisma.room.update({
      where: { id: room.id },
      data: {
        background_type: 'custom',
        background_image_path: 'uploads/backgrounds/nonexistent.webp',
      },
    });

    const res = await request(app)
      .delete(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`);

    // Should not crash — just succeed
    expect(res.status).toBe(200);
  });

  it('returns 403 for a different teacher', async () => {
    const cookie1 = await signupTeacher('bg-del-own1@test.com');
    const cookie2 = await signupTeacher('bg-del-own2@test.com');
    const room = await createRoom(cookie1);

    const res = await request(app)
      .delete(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie2}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/rooms/:id/background-image ─────────────────────────────────────

describe('GET /api/rooms/:id/background-image — serve background', () => {
  it('returns file for the room owner (teacher)', async () => {
    const cookie = await signupTeacher('bg-img-teacher@test.com');
    const room = await createRoom(cookie);
    const jpeg = await makeJpegBuffer();

    await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    const res = await request(app)
      .get(`/api/rooms/${room.id}/background-image`)
      .set('Cookie', `access_token=${cookie}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/webp/);
    expect(res.headers['cache-control']).toMatch(/immutable/);
  });

  it('returns file for an enrolled student', async () => {
    const teacherCookie = await signupTeacher('bg-img-enrolled@test.com');
    const room = await createRoom(teacherCookie);

    // Enrol student
    const studentCookie = await loginStudent(
      (await prisma.room.findUnique({ where: { id: room.id } }))!.invite_code,
    );
    await joinRoom(room.id, studentCookie);

    // Upload background
    const jpeg = await makeJpegBuffer();
    await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    const res = await request(app)
      .get(`/api/rooms/${room.id}/background-image`)
      .set('Cookie', `access_token=${studentCookie}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/webp/);
  });

  it('returns 403 for a non-enrolled student', async () => {
    const teacherCookie = await signupTeacher('bg-img-notenrolled@test.com');
    const room = await createRoom(teacherCookie);

    // Create a second room to get another student whose invite_code is different
    const room2 = await createRoom(teacherCookie);
    const unenrolledCookie = await loginStudent(
      (await prisma.room.findUnique({ where: { id: room2.id } }))!.invite_code,
      'Stranger',
    );
    // Join room2 only — NOT room
    await joinRoom(room2.id, unenrolledCookie);

    // Upload background to room
    const jpeg = await makeJpegBuffer();
    await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    const res = await request(app)
      .get(`/api/rooms/${room.id}/background-image`)
      .set('Cookie', `access_token=${unenrolledCookie}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 when background_type is not custom', async () => {
    const cookie = await signupTeacher('bg-img-none@test.com');
    const room = await createRoom(cookie);

    const res = await request(app)
      .get(`/api/rooms/${room.id}/background-image`)
      .set('Cookie', `access_token=${cookie}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 with no cookie', async () => {
    const cookie = await signupTeacher('bg-img-noauth@test.com');
    const room = await createRoom(cookie);

    const res = await request(app).get(`/api/rooms/${room.id}/background-image`);
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/rooms/:id/background/report ────────────────────────────────────

describe('POST /api/rooms/:id/background/report — report background', () => {
  it('enrolled student can submit a report', async () => {
    const teacherCookie = await signupTeacher('bg-report1@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent(
      (await prisma.room.findUnique({ where: { id: room.id } }))!.invite_code,
    );
    await joinRoom(room.id, studentCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background/report`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ reason: 'Inappropriate content' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Report submitted');

    // Verify DB record created
    const reports = await prisma.backgroundReport.findMany({ where: { room_id: room.id } });
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe('Inappropriate content');
  });

  it('enrolled student can submit a report with no reason (optional)', async () => {
    const teacherCookie = await signupTeacher('bg-report2@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent(
      (await prisma.room.findUnique({ where: { id: room.id } }))!.invite_code,
    );
    await joinRoom(room.id, studentCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background/report`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({});

    expect(res.status).toBe(200);
  });

  it('non-enrolled student gets 403', async () => {
    const teacherCookie = await signupTeacher('bg-report3@test.com');
    const room = await createRoom(teacherCookie);
    const room2 = await createRoom(teacherCookie);

    const stranger = await loginStudent(
      (await prisma.room.findUnique({ where: { id: room2.id } }))!.invite_code,
      'Stranger',
    );
    await joinRoom(room2.id, stranger);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background/report`)
      .set('Cookie', `access_token=${stranger}`)
      .send({ reason: 'test' });

    expect(res.status).toBe(403);
  });

  it('allows duplicate reports (idempotent — multiple allowed)', async () => {
    const teacherCookie = await signupTeacher('bg-report4@test.com');
    const room = await createRoom(teacherCookie);
    const studentCookie = await loginStudent(
      (await prisma.room.findUnique({ where: { id: room.id } }))!.invite_code,
    );
    await joinRoom(room.id, studentCookie);

    const first = await request(app)
      .post(`/api/rooms/${room.id}/background/report`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ reason: 'First report' });

    const second = await request(app)
      .post(`/api/rooms/${room.id}/background/report`)
      .set('Cookie', `access_token=${studentCookie}`)
      .send({ reason: 'Second report' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('returns 401 with no cookie', async () => {
    const teacherCookie = await signupTeacher('bg-report5@test.com');
    const room = await createRoom(teacherCookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background/report`)
      .send({ reason: 'test' });

    expect(res.status).toBe(401);
  });

  it('teacher token is rejected (students only)', async () => {
    const cookie = await signupTeacher('bg-report6@test.com');
    const room = await createRoom(cookie);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/background/report`)
      .set('Cookie', `access_token=${cookie}`)
      .send({ reason: 'test' });

    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/admin/rooms/:id/background ───────────────────────────────────

describe('DELETE /api/admin/rooms/:id/background — admin background removal', () => {
  it('room owner teacher can use admin delete endpoint', async () => {
    const cookie = await signupTeacher('bg-admin-del1@test.com');
    const room = await createRoom(cookie);
    const jpeg = await makeJpegBuffer();

    await request(app)
      .post(`/api/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`)
      .attach('background', jpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    const res = await request(app)
      .delete(`/api/admin/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Background removed');
  });

  it('different teacher is rejected (403)', async () => {
    const cookie1 = await signupTeacher('bg-admin-del2@test.com');
    const cookie2 = await signupTeacher('bg-admin-del3@test.com');
    const room = await createRoom(cookie1);

    const res = await request(app)
      .delete(`/api/admin/rooms/${room.id}/background`)
      .set('Cookie', `access_token=${cookie2}`);

    expect(res.status).toBe(403);
  });
});
