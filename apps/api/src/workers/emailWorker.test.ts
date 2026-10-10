// ─── jest.mock calls are hoisted above all imports ────────────────────────────

jest.mock('../lib/mailer', () => ({
  sendMail: jest.fn().mockResolvedValue(undefined),
  verifyConnection: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/redis', () => ({
  __esModule: true,
  default: { options: {} },
}));

jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Worker: jest.fn().mockImplementation((_name: string, processor: unknown) => ({
    on: jest.fn(),
    _processor: processor,
  })),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    attendanceRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
    teacher: {
      findUnique: jest.fn(),
    },
  })),
}));

// ─── Imports (happen after mock hoisting) ─────────────────────────────────────

import { Job } from 'bullmq';
import * as mailer from '../lib/mailer';
import { createEmailWorker } from './emailWorker';
import { createMagicLinkWorker } from './magicLinkWorker';

// ─── Typed helpers ────────────────────────────────────────────────────────────

type PrismaMock = {
  attendanceRecord: { findUnique: jest.Mock; update: jest.Mock };
  student: { findUnique: jest.Mock };
  teacher: { findUnique: jest.Mock };
};

const sendMail = mailer.sendMail as jest.MockedFunction<typeof mailer.sendMail>;
const { Worker: WorkerCtor } = jest.requireMock('bullmq') as { Worker: jest.Mock };

// The PrismaClient factory creates a new object per call. Each worker module
// calls new PrismaClient() at module init, populating mock.results[n].value.
// We grab those references once (they are stable objects; clearAllMocks only
// clears .mock.calls/.results tracking, not the objects themselves).
function getEmailPrisma(): PrismaMock {
  const { PrismaClient } = jest.requireMock('@prisma/client') as { PrismaClient: jest.Mock };
  return PrismaClient.mock.results[0].value as PrismaMock;
}

function getMlPrisma(): PrismaMock {
  const { PrismaClient } = jest.requireMock('@prisma/client') as { PrismaClient: jest.Mock };
  return PrismaClient.mock.results[1].value as PrismaMock;
}

function getLastWorkerProcessor(): (job: Job) => Promise<void> {
  const lastResult = WorkerCtor.mock.results[WorkerCtor.mock.results.length - 1];
  return (lastResult.value as { _processor: (job: Job) => Promise<void> })._processor;
}

function makeJob<T>(name: string, data: T): Job<T> {
  return { id: 'job-1', name, data } as unknown as Job<T>;
}

// We need these prisma references BEFORE any clearAllMocks runs.
// Capture them after imports (which trigger module-level new PrismaClient() calls).
let emailPrisma: PrismaMock;
let mlPrisma: PrismaMock;

beforeAll(() => {
  emailPrisma = getEmailPrisma();
  mlPrisma = getMlPrisma();
});

// After jest.clearAllMocks(), the mock.results array is cleared.
// However, emailPrisma/mlPrisma hold direct object references — the underlying
// jest.fn() properties on those objects are still valid (just their call history is cleared).
// So we do NOT need to re-capture them after each clearAllMocks.

// ─── emailWorker — parent-notification ───────────────────────────────────────

describe('emailWorker — parent-notification', () => {
  const NOW = new Date('2024-03-15T08:30:00.000Z');

  const baseRecord = {
    id: 'rec-1',
    method: 'qr_scan',
    marked_by_officer_id: null,
    parent_notified_at: null,
    scanned_at: NOW,
    student: { name: 'Alice Cruz', parent_email: 'parent@example.com' },
    session: { room: { name: 'Math 101' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue(undefined);
    WorkerCtor.mockClear();
  });

  test('sends email and updates parent_notified_at for a QR scan', async () => {
    emailPrisma.attendanceRecord.findUnique.mockResolvedValue(baseRecord);
    emailPrisma.attendanceRecord.update.mockResolvedValue({});

    createEmailWorker();
    const processor = getLastWorkerProcessor();
    await processor(makeJob('parent-notification', { recordId: 'rec-1' }));

    expect(emailPrisma.attendanceRecord.findUnique).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      include: expect.anything(),
    });
    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('parent@example.com');
    expect(mail.subject).toContain('Alice Cruz');
    expect(mail.subject).toContain('marked present');
    expect(mail.html).toContain('Alice Cruz');
    expect(mail.html).toContain('Math 101');
    expect(mail.html).toContain('QR scan');
    expect(mail.text).toContain('QR scan');

    expect(emailPrisma.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { parent_notified_at: expect.any(Date) },
    });
  });

  test('skips when parent_email is null', async () => {
    emailPrisma.attendanceRecord.findUnique.mockResolvedValue({
      ...baseRecord,
      student: { name: 'Alice Cruz', parent_email: null },
    });

    createEmailWorker();
    const processor = getLastWorkerProcessor();
    await processor(makeJob('parent-notification', { recordId: 'rec-1' }));

    expect(sendMail).not.toHaveBeenCalled();
    expect(emailPrisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  test('skips (idempotency guard) when parent_notified_at is already set', async () => {
    emailPrisma.attendanceRecord.findUnique.mockResolvedValue({
      ...baseRecord,
      parent_notified_at: NOW,
    });

    createEmailWorker();
    const processor = getLastWorkerProcessor();
    await processor(makeJob('parent-notification', { recordId: 'rec-1' }));

    expect(sendMail).not.toHaveBeenCalled();
    expect(emailPrisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  test('includes officer name in email body for manual entries', async () => {
    emailPrisma.attendanceRecord.findUnique.mockResolvedValue({
      ...baseRecord,
      method: 'manual',
      marked_by_officer_id: 'officer-1',
    });
    emailPrisma.student.findUnique.mockResolvedValue({ name: 'Bob Reyes' });
    emailPrisma.attendanceRecord.update.mockResolvedValue({});

    createEmailWorker();
    const processor = getLastWorkerProcessor();
    await processor(makeJob('parent-notification', { recordId: 'rec-1' }));

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.html).toContain('Manual by Bob Reyes');
    expect(mail.text).toContain('Manual by Bob Reyes');
  });

  test('throws on SMTP error so BullMQ retries (parent_notified_at not updated)', async () => {
    emailPrisma.attendanceRecord.findUnique.mockResolvedValue(baseRecord);
    sendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    createEmailWorker();
    const processor = getLastWorkerProcessor();
    await expect(
      processor(makeJob('parent-notification', { recordId: 'rec-1' })),
    ).rejects.toThrow('SMTP connection refused');

    expect(emailPrisma.attendanceRecord.update).not.toHaveBeenCalled();
  });
});

// ─── magicLinkWorker — magic-link ────────────────────────────────────────────

describe('magicLinkWorker — magic-link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue(undefined);
    WorkerCtor.mockClear();
    process.env.WEB_ORIGIN = 'http://localhost:3000';
  });

  test('sends sign-in email with correct URL and room name', async () => {
    createMagicLinkWorker();
    const processor = getLastWorkerProcessor();

    await processor(
      makeJob('magic-link', {
        type: 'magic-link',
        to: 'student@example.com',
        token: 'abc123',
        inviteCode: 'ROOM01',
        roomName: 'Science 202',
      }),
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('student@example.com');
    expect(mail.subject).toBe('Your TangkayScan sign-in link');
    expect(mail.html).toContain('http://localhost:3000/auth/verify/abc123');
    expect(mail.html).toContain('Science 202');
    expect(mail.text).toContain('http://localhost:3000/auth/verify/abc123');
  });
});

// ─── magicLinkWorker — teacher-approval-needed ───────────────────────────────

describe('magicLinkWorker — teacher-approval-needed', () => {
  const NOW = new Date('2024-03-15T08:30:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue(undefined);
    WorkerCtor.mockClear();
  });

  test('sends approval email to teacher with student and officer names', async () => {
    mlPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 'rec-2',
      method: 'manual',
      marked_by_officer_id: 'officer-2',
      parent_notified_at: null,
      scanned_at: NOW,
      student: { name: 'Carlo Santos' },
      session: { room: { name: 'PE Class' } },
    });
    mlPrisma.teacher.findUnique.mockResolvedValue({ email: 'teacher@school.edu' });
    mlPrisma.student.findUnique.mockResolvedValue({ name: 'Dana Lopez' });

    createMagicLinkWorker();
    const processor = getLastWorkerProcessor();

    await processor(
      makeJob('teacher-approval-needed', {
        type: 'teacher-approval-needed',
        recordId: 'rec-2',
        teacherId: 'teacher-1',
      }),
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('teacher@school.edu');
    expect(mail.subject).toContain('approval');
    expect(mail.html).toContain('Carlo Santos');
    expect(mail.html).toContain('PE Class');
    expect(mail.html).toContain('Dana Lopez');
    expect(mail.text).toContain('Dana Lopez');
  });
});
