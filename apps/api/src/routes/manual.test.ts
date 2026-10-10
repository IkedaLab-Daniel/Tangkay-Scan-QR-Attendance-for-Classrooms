import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import redis from '../lib/redis';
import * as tokenRotator from '../lib/tokenRotator';
import * as queue from '../lib/queue';

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
  requireManualApproval = true,
): Promise<{ id: string; invite_code: string }> {
  const res = await request(app)
    .post('/api/rooms')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ name: 'Manual Test Room', attendance_mode: 'balanced' });
  const room = res.body as { id: string; invite_code: string };

  if (!requireManualApproval) {
    // Patch room to set require_manual_approval = false
    await prisma.room.update({
      where: { id: room.id },
      data: { require_manual_approval: false },
    });
  }
  return room;
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

async function makeOfficer(roomId: string, memberId: string, teacherCookie: string): Promise<void> {
  await request(app)
    .post(`/api/rooms/${roomId}/officers`)
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ memberId, officerTitle: 'Class Officer' });
}

async function startSession(teacherCookie: string, roomId: string): Promise<string> {
  const res = await request(app)
    .post('/api/sessions')
    .set('Cookie', `access_token=${teacherCookie}`)
    .send({ roomId });
  return (res.body as { id: string }).id;
}

/** Generate a valid 10×10 JPEG data URI using sharp */
async function makeJpegDataUri(): Promise<string> {
  const buf = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
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

// ─── POST /api/sessions/:id/manual ───────────────────────────────────────────

describe('POST /api/sessions/:id/manual', () => {
  it('happy path with photo — record created, file saved, approval_status=pending when require_manual_approval=true', async () => {
    const teacherCookie = await signupTeacher('man-t1@test.com');
    const room = await createRoom(teacherCookie, true); // require_manual_approval = true
    const officerCookie = await loginStudent('man-o1@test.com', 'Officer', room.invite_code);
    const officerMemberId = await joinRoom(room.id, officerCookie);
    await makeOfficer(room.id, officerMemberId, teacherCookie);
    const studentCookie = await loginStudent('man-s1@test.com', 'Student', room.invite_code);
    const studentMember = await joinRoom(room.id, studentCookie);
    const student = await prisma.roomMember.findUnique({
      where: { id: studentMember },
      select: { student_id: true },
    });
    const sessionId = await startSession(teacherCookie, room.id);

    // Spy on emailQueue to verify teacher-approval-needed is enqueued
    const emailSpy = jest.spyOn(queue.emailQueue, 'add').mockResolvedValue({} as never);

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${officerCookie}`)
      .send({ studentId: student!.student_id, photoDataUrl: await makeJpegDataUri() });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.record.approval_status).toBe('pending');
    expect(res.body.record.method).toBe('manual');
    expect(res.body.record.selfie_url).toMatch(/^uploads\/manual\//);

    // Verify file was saved
    const filePath = path.join(process.cwd(), res.body.record.selfie_url);
    expect(fs.existsSync(filePath)).toBe(true);

    // Verify teacher notification was enqueued
    expect(emailSpy).toHaveBeenCalledWith(
      'teacher-approval-needed',
      expect.objectContaining({ type: 'teacher-approval-needed' }),
    );

    emailSpy.mockRestore();

    // Cleanup file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('happy path without photo — approval_status=approved when require_manual_approval=false', async () => {
    const teacherCookie = await signupTeacher('man-t2@test.com');
    const room = await createRoom(teacherCookie, false); // require_manual_approval = false
    const officerCookie = await loginStudent('man-o2@test.com', 'Officer', room.invite_code);
    const officerMemberId = await joinRoom(room.id, officerCookie);
    await makeOfficer(room.id, officerMemberId, teacherCookie);
    const studentCookie = await loginStudent('man-s2@test.com', 'Student', room.invite_code);
    const studentMember = await joinRoom(room.id, studentCookie);
    const student = await prisma.roomMember.findUnique({
      where: { id: studentMember },
      select: { student_id: true },
    });
    const sessionId = await startSession(teacherCookie, room.id);

    const parentSpy = jest.spyOn(queue.parentQueue, 'add').mockResolvedValue({} as never);

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${officerCookie}`)
      .send({ studentId: student!.student_id });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('recorded');
    expect(res.body.record.approval_status).toBe('approved');
    expect(res.body.record.selfie_url).toBeNull();

    // Parent notification should be enqueued immediately
    expect(parentSpy).toHaveBeenCalledWith(
      'parent-notification',
      expect.objectContaining({ recordId: res.body.record.id }),
    );

    parentSpy.mockRestore();
  });

  it('404 when student is not enrolled in the room', async () => {
    const teacherCookie = await signupTeacher('man-t3@test.com');
    const room = await createRoom(teacherCookie, true);
    const officerCookie = await loginStudent('man-o3@test.com', 'Officer', room.invite_code);
    const officerMemberId = await joinRoom(room.id, officerCookie);
    await makeOfficer(room.id, officerMemberId, teacherCookie);
    const sessionId = await startSession(teacherCookie, room.id);

    // Create an unrelated student not in the room
    const otherStudent = await prisma.student.create({
      data: { name: 'Outsider', email: 'outsider@test.com' },
    });

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${officerCookie}`)
      .send({ studentId: otherStudent.id });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not enrolled/i);
  });

  it('409 when student already has a pending or approved record in this session', async () => {
    const teacherCookie = await signupTeacher('man-t4@test.com');
    const room = await createRoom(teacherCookie, true);
    const officerCookie = await loginStudent('man-o4@test.com', 'Officer', room.invite_code);
    const officerMemberId = await joinRoom(room.id, officerCookie);
    await makeOfficer(room.id, officerMemberId, teacherCookie);
    const studentCookie = await loginStudent('man-s4@test.com', 'Student', room.invite_code);
    const studentMember = await joinRoom(room.id, studentCookie);
    const student = await prisma.roomMember.findUnique({
      where: { id: studentMember },
      select: { student_id: true },
    });
    const sessionId = await startSession(teacherCookie, room.id);

    const emailSpy = jest.spyOn(queue.emailQueue, 'add').mockResolvedValue({} as never);

    // First mark — should succeed
    await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${officerCookie}`)
      .send({ studentId: student!.student_id });

    // Second mark — should 409
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${officerCookie}`)
      .send({ studentId: student!.student_id });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already recorded/i);

    emailSpy.mockRestore();
  });

  it('401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/sessions/nonexistent-id/manual')
      .send({ studentId: 'some-id' });

    expect(res.status).toBe(401);
  });

  it('403 when authenticated student is not an officer', async () => {
    const teacherCookie = await signupTeacher('man-t5@test.com');
    const room = await createRoom(teacherCookie, true);
    const regularStudentCookie = await loginStudent('man-s5@test.com', 'Regular', room.invite_code);
    const studentMember = await joinRoom(room.id, regularStudentCookie);
    const student = await prisma.roomMember.findUnique({
      where: { id: studentMember },
      select: { student_id: true },
    });
    const sessionId = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${regularStudentCookie}`)
      .send({ studentId: student!.student_id });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/officer/i);
  });
});

// ─── PATCH /api/sessions/:sessionId/records/:recordId/approve ────────────────

describe('PATCH /api/sessions/:sessionId/records/:recordId/approve', () => {
  async function createPendingRecord(
    teacherCookie: string,
    room: { id: string; invite_code: string },
    sessionId: string,
  ): Promise<{ recordId: string; officerCookie: string }> {
    const officerCookie = await loginStudent(
      `man-oa-${Date.now()}@test.com`,
      'Officer',
      room.invite_code,
    );
    const officerMemberId = await joinRoom(room.id, officerCookie);
    await makeOfficer(room.id, officerMemberId, teacherCookie);

    const studentCookie = await loginStudent(
      `man-sa-${Date.now()}@test.com`,
      'Student',
      room.invite_code,
    );
    const studentMember = await joinRoom(room.id, studentCookie);
    const student = await prisma.roomMember.findUnique({
      where: { id: studentMember },
      select: { student_id: true },
    });

    const emailSpy = jest.spyOn(queue.emailQueue, 'add').mockResolvedValue({} as never);
    const manualRes = await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${officerCookie}`)
      .send({ studentId: student!.student_id });
    emailSpy.mockRestore();

    return { recordId: manualRes.body.record.id as string, officerCookie };
  }

  it('approve pending → approved + parent email queued', async () => {
    const teacherCookie = await signupTeacher('man-ta1@test.com');
    const room = await createRoom(teacherCookie, true);
    const sessionId = await startSession(teacherCookie, room.id);
    const { recordId } = await createPendingRecord(teacherCookie, room, sessionId);

    const parentSpy = jest.spyOn(queue.parentQueue, 'add').mockResolvedValue({} as never);

    const res = await request(app)
      .patch(`/api/sessions/${sessionId}/records/${recordId}/approve`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.approval_status).toBe('approved');
    expect(parentSpy).toHaveBeenCalledWith(
      'parent-notification',
      expect.objectContaining({ recordId }),
    );

    parentSpy.mockRestore();
  });

  it('reject pending → rejected', async () => {
    const teacherCookie = await signupTeacher('man-ta2@test.com');
    const room = await createRoom(teacherCookie, true);
    const sessionId = await startSession(teacherCookie, room.id);
    const { recordId } = await createPendingRecord(teacherCookie, room, sessionId);

    const res = await request(app)
      .patch(`/api/sessions/${sessionId}/records/${recordId}/approve`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ decision: 'rejected' });

    expect(res.status).toBe(200);
    expect(res.body.approval_status).toBe('rejected');
  });

  it('400 when record is already decided (not pending)', async () => {
    const teacherCookie = await signupTeacher('man-ta3@test.com');
    const room = await createRoom(teacherCookie, true);
    const sessionId = await startSession(teacherCookie, room.id);
    const { recordId } = await createPendingRecord(teacherCookie, room, sessionId);

    // First approve
    await request(app)
      .patch(`/api/sessions/${sessionId}/records/${recordId}/approve`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ decision: 'approved' });

    // Try again
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}/records/${recordId}/approve`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not pending/i);
  });

  it('403 when a different teacher tries to approve', async () => {
    const teacherCookie = await signupTeacher('man-ta4a@test.com');
    const otherTeacherCookie = await signupTeacher('man-ta4b@test.com');
    const room = await createRoom(teacherCookie, true);
    const sessionId = await startSession(teacherCookie, room.id);
    const { recordId } = await createPendingRecord(teacherCookie, room, sessionId);

    const res = await request(app)
      .patch(`/api/sessions/${sessionId}/records/${recordId}/approve`)
      .set('Cookie', `access_token=${otherTeacherCookie}`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(403);
  });

  it('404 when record does not exist', async () => {
    const teacherCookie = await signupTeacher('man-ta5@test.com');
    const room = await createRoom(teacherCookie, true);
    const sessionId = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .patch(`/api/sessions/${sessionId}/records/nonexistentrecordid/approve`)
      .set('Cookie', `access_token=${teacherCookie}`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/sessions/:id/records/manual ─────────────────────────────────────

describe('GET /api/sessions/:id/records/manual', () => {
  it('returns manual attendance records for the session', async () => {
    const teacherCookie = await signupTeacher('man-tg1@test.com');
    const room = await createRoom(teacherCookie, true);
    const sessionId = await startSession(teacherCookie, room.id);

    const officerCookie = await loginStudent('man-og1@test.com', 'Officer', room.invite_code);
    const officerMemberId = await joinRoom(room.id, officerCookie);
    await makeOfficer(room.id, officerMemberId, teacherCookie);

    const studentCookie = await loginStudent('man-sg1@test.com', 'Student', room.invite_code);
    const studentMemberId = await joinRoom(room.id, studentCookie);
    const studentMember = await prisma.roomMember.findUnique({
      where: { id: studentMemberId },
      select: { student_id: true },
    });

    const emailSpy = jest.spyOn(queue.emailQueue, 'add').mockResolvedValue({} as never);
    await request(app)
      .post(`/api/sessions/${sessionId}/manual`)
      .set('Cookie', `access_token=${officerCookie}`)
      .send({ studentId: studentMember!.student_id });
    emailSpy.mockRestore();

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records/manual`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].method).toBe('manual');
    expect(res.body[0].approval_status).toBe('pending');
    expect(res.body[0].student).toBeDefined();
    expect(res.body[0].officer_name).toBeDefined();
    expect(res.body[0].scanned_at).toBeDefined();
  });

  it('403 when wrong teacher requests records', async () => {
    const teacherCookie = await signupTeacher('man-tg2a@test.com');
    const otherTeacherCookie = await signupTeacher('man-tg2b@test.com');
    const room = await createRoom(teacherCookie, true);
    const sessionId = await startSession(teacherCookie, room.id);

    const res = await request(app)
      .get(`/api/sessions/${sessionId}/records/manual`)
      .set('Cookie', `access_token=${otherTeacherCookie}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/uploads/manual/:filename ───────────────────────────────────────

describe('GET /api/uploads/manual/:filename', () => {
  const testFilename = 'test-manual-file.webp';
  const testFilePath = path.join(process.cwd(), 'uploads', 'manual', testFilename);

  beforeAll(async () => {
    const dir = path.join(process.cwd(), 'uploads', 'manual');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Write a valid WebP file for serving tests
    const buf = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).webp().toBuffer();
    fs.writeFileSync(testFilePath, buf);
  });

  afterAll(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });

  it('returns the file when teacher is authenticated', async () => {
    const teacherCookie = await signupTeacher('man-file1@test.com');

    const res = await request(app)
      .get(`/api/uploads/manual/${testFilename}`)
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image/);
  });

  it('returns the file when officer (student) is authenticated', async () => {
    const teacherCookie = await signupTeacher('man-file2@test.com');
    const room = await createRoom(teacherCookie);
    const officerCookie = await loginStudent('man-fileofficer@test.com', 'Officer', room.invite_code);
    const memberId = await joinRoom(room.id, officerCookie);
    await makeOfficer(room.id, memberId, teacherCookie);

    const res = await request(app)
      .get(`/api/uploads/manual/${testFilename}`)
      .set('Cookie', `access_token=${officerCookie}`);

    expect(res.status).toBe(200);
  });

  it('returns 404 when file does not exist', async () => {
    const teacherCookie = await signupTeacher('man-file3@test.com');

    const res = await request(app)
      .get('/api/uploads/manual/nonexistent-file.jpg')
      .set('Cookie', `access_token=${teacherCookie}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/uploads/manual/${testFilename}`);
    expect(res.status).toBe(401);
  });
});
