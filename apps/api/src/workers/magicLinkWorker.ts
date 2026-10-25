import { Worker, Job } from 'bullmq';
import redis from '../lib/redis';
import * as mailer from '../lib/mailer';
import type { EmailJobData } from '../lib/queue';
import { prisma } from '../lib/prisma';

// ─── Magic-link email ─────────────────────────────────────────────────────────

function buildMagicLinkHtml(signInUrl: string, roomName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e0e0e0;border-radius:4px;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #e0e0e0;">
            <p style="margin:0;font-size:18px;font-weight:bold;color:#1a1a1a;">TangkayScan</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#333333;">Hello,</p>
            <p style="margin:0 0 16px;font-size:15px;color:#333333;">
              You have been invited to join <strong>${roomName}</strong> on TangkayScan.
              Click the button below to sign in. This link expires in 15 minutes.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr>
                <td style="background-color:#2563eb;border-radius:4px;text-align:center;">
                  <a href="${signInUrl}"
                     style="display:inline-block;padding:12px 28px;font-size:15px;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;">
                    Sign in to TangkayScan
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#666666;">
              If the button does not work, copy and paste this link into your browser:
            </p>
            <p style="margin:0;font-size:13px;color:#2563eb;word-break:break-all;">${signInUrl}</p>
            <p style="margin:24px 0 0;font-size:13px;color:#888888;">
              If you did not request this link, you can ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e0e0e0;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;">TangkayScan Attendance System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Teacher-approval-needed email ───────────────────────────────────────────

function buildApprovalHtml(opts: {
  studentName: string;
  roomName: string;
  officerName: string;
  scannedAt: Date;
}): string {
  const { studentName, roomName, officerName, scannedAt } = opts;
  const dateStr = scannedAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = scannedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e0e0e0;border-radius:4px;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #e0e0e0;">
            <p style="margin:0;font-size:18px;font-weight:bold;color:#1a1a1a;">TangkayScan</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#333333;">Hello,</p>
            <p style="margin:0 0 16px;font-size:15px;color:#333333;">
              A manual attendance entry needs your approval in <strong>${roomName}</strong>.
            </p>
            <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:24px;">
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;border-bottom:1px solid #e0e0e0;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Student</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${studentName}</p>
              </td></tr>
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;border-bottom:1px solid #e0e0e0;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Marked by</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${officerName}</p>
              </td></tr>
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;border-bottom:1px solid #e0e0e0;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${dateStr}</p>
              </td></tr>
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Time</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${timeStr}</p>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;color:#666666;">
              Please log in to TangkayScan to approve or reject this entry.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e0e0e0;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;">TangkayScan Attendance System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

async function processMagicLink(job: Job<EmailJobData>): Promise<void> {
  const { to, token, inviteCode, roomName } = job.data;

  if (!to || !token) {
    console.warn(`[magicLinkWorker] magic-link job ${job.id} missing to/token — skipping`);
    return;
  }

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const signInUrl = `${webOrigin}/verify/${token}`;
  const room = roomName ?? (inviteCode ? `invite code ${inviteCode}` : 'TangkayScan');

  const html = buildMagicLinkHtml(signInUrl, room);
  const text = [
    `Hello,`,
    ``,
    `You have been invited to join ${room} on TangkayScan.`,
    `Sign in using this link (expires in 15 minutes):`,
    ``,
    signInUrl,
    ``,
    `If you did not request this link, you can ignore this email.`,
    ``,
    `TangkayScan Attendance System`,
  ].join('\n');

  await mailer.sendMail({ to, subject: 'Your TangkayScan sign-in link', html, text });
}

async function processTeacherApproval(job: Job<EmailJobData>): Promise<void> {
  const { recordId, teacherId } = job.data;

  if (!recordId || !teacherId) {
    console.warn(`[magicLinkWorker] teacher-approval-needed job ${job.id} missing fields — skipping`);
    return;
  }

  const [record, teacher] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        student: { select: { name: true } },
        session: { include: { room: { select: { name: true } } } },
      },
    }),
    prisma.teacher.findUnique({ where: { id: teacherId }, select: { email: true } }),
  ]);

  if (!record || !teacher) {
    console.warn(`[magicLinkWorker] teacher-approval-needed: record or teacher not found — skipping`);
    return;
  }

  let officerName = 'an officer';
  if (record.marked_by_officer_id) {
    const officer = await prisma.student.findUnique({
      where: { id: record.marked_by_officer_id },
      select: { name: true },
    });
    if (officer) officerName = officer.name;
  }

  const studentName = record.student.name;
  const roomName = record.session.room.name;

  const subject = `[TangkayScan] Manual attendance entry needs your approval`;
  const html = buildApprovalHtml({ studentName, roomName, officerName, scannedAt: record.scanned_at });
  const text = [
    `Hello,`,
    ``,
    `A manual attendance entry needs your approval in ${roomName}.`,
    ``,
    `Student: ${studentName}`,
    `Marked by: ${officerName}`,
    `Date: ${record.scanned_at.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Time: ${record.scanned_at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    ``,
    `Please log in to TangkayScan to approve or reject this entry.`,
    ``,
    `TangkayScan Attendance System`,
  ].join('\n');

  await mailer.sendMail({ to: teacher.email, subject, html, text });
}

// ─── Email verification email ─────────────────────────────────────────────────

function buildVerifyEmailHtml(verifyUrl: string, studentName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e0e0e0;border-radius:4px;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #e0e0e0;">
            <p style="margin:0;font-size:18px;font-weight:bold;color:#1a1a1a;">TangkayScan</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#333333;">Hi ${studentName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#333333;">
              Thanks for signing up! Click the button below to verify your email address and activate your account.
              This link expires in <strong>1 hour</strong>.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr>
                <td style="background-color:#126a3a;border-radius:4px;text-align:center;">
                  <a href="${verifyUrl}"
                     style="display:inline-block;padding:12px 28px;font-size:15px;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;">
                    Verify my email
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#666666;">
              If the button does not work, copy and paste this link into your browser:
            </p>
            <p style="margin:0;font-size:13px;color:#126a3a;word-break:break-all;">${verifyUrl}</p>
            <p style="margin:24px 0 0;font-size:13px;color:#888888;">
              If you did not create this account, you can ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e0e0e0;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;">TangkayScan Attendance System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function processVerifyEmail(job: Job<EmailJobData>): Promise<void> {
  const { to, token, studentName } = job.data;

  if (!to || !token) {
    console.warn(`[magicLinkWorker] verify-email job ${job.id} missing to/token — skipping`);
    return;
  }

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const verifyUrl = `${webOrigin}/auth/student/verify-email/${token}`;
  const name = studentName ?? 'there';

  const html = buildVerifyEmailHtml(verifyUrl, name);
  const text = [
    `Hi ${name},`,
    ``,
    `Thanks for signing up for TangkayScan! Verify your email using this link (expires in 1 hour):`,
    ``,
    verifyUrl,
    ``,
    `If you did not create this account, you can ignore this email.`,
    ``,
    `TangkayScan Attendance System`,
  ].join('\n');

  await mailer.sendMail({ to, subject: 'Verify your TangkayScan account', html, text });
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export function createMagicLinkWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    'email',
    async (job) => {
      if (job.name === 'magic-link') {
        await processMagicLink(job);
      } else if (job.name === 'verify-email') {
        await processVerifyEmail(job);
      } else if (job.name === 'teacher-approval-needed') {
        await processTeacherApproval(job);
      }
    },
    {
      connection: redis,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[magicLinkWorker] Job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  return worker;
}
