import { Worker, Job } from 'bullmq';
import redis from '../lib/redis';
import * as mailer from '../lib/mailer';
import type { ParentNotificationJobData } from '../lib/queue';
import { prisma } from '../lib/prisma';

function buildParentHtml(opts: {
  studentName: string;
  roomName: string;
  scannedAt: Date;
  method: string;
}): string {
  const { studentName, roomName, scannedAt, method } = opts;
  const dateStr = scannedAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = scannedAt.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

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
              This is a notification that <strong>${studentName}</strong> has been marked present.
            </p>
            <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:24px;">
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;border-bottom:1px solid #e0e0e0;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Room</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${roomName}</p>
              </td></tr>
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;border-bottom:1px solid #e0e0e0;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${dateStr}</p>
              </td></tr>
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;border-bottom:1px solid #e0e0e0;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Time</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${timeStr}</p>
              </td></tr>
              <tr><td style="padding:12px 16px;background-color:#f7f7f7;">
                <p style="margin:0;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:0.5px;">Method</p>
                <p style="margin:4px 0 0;font-size:15px;color:#1a1a1a;">${method}</p>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;color:#888888;">
              You received this message because a parent email is associated with this student account in TangkayScan.
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

async function processParentNotification(job: Job<ParentNotificationJobData>): Promise<void> {
  const { recordId } = job.data;

  const record = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    include: {
      student: { select: { name: true, parent_email: true } },
      session: { include: { room: { select: { name: true } } } },
    },
  });

  if (!record) {
    console.warn(`[emailWorker] Record ${recordId} not found — skipping`);
    return;
  }

  if (!record.student.parent_email) {
    console.warn(`[emailWorker] Student has no parent_email for record ${recordId} — skipping`);
    return;
  }

  // Idempotency guard
  if (record.parent_notified_at) {
    console.warn(`[emailWorker] Record ${recordId} already notified — skipping`);
    return;
  }

  // Resolve officer name for manual entries
  let method: string;
  if (record.method === 'manual' && record.marked_by_officer_id) {
    const officer = await prisma.student.findUnique({
      where: { id: record.marked_by_officer_id },
      select: { name: true },
    });
    method = `Manual by ${officer?.name ?? 'an officer'}`;
  } else {
    method = 'QR scan';
  }

  const studentName = record.student.name;
  const roomName = record.session.room.name;
  const scannedAt = record.scanned_at;

  const subject = `[TangkayScan] ${studentName} has been marked present`;
  const html = buildParentHtml({ studentName, roomName, scannedAt, method });
  const text = [
    `Hello,`,
    ``,
    `${studentName} has been marked present.`,
    ``,
    `Room: ${roomName}`,
    `Date: ${scannedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Time: ${scannedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    `Method: ${method}`,
    ``,
    `TangkayScan Attendance System`,
  ].join('\n');

  await mailer.sendMail({ to: record.student.parent_email, subject, html, text });

  await prisma.attendanceRecord.update({
    where: { id: recordId },
    data: { parent_notified_at: new Date() },
  });
}

export function createEmailWorker(): Worker<ParentNotificationJobData> {
  const worker = new Worker<ParentNotificationJobData>(
    'parent-notification',
    async (job) => {
      if (job.name === 'parent-notification') {
        await processParentNotification(job);
      }
    },
    {
      connection: redis,
      concurrency: 2,
      limiter: { max: 10, duration: 60_000 },
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[emailWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
