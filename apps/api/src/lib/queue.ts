import { Queue } from 'bullmq';
import redis from './redis';

export interface EmailJobData {
  type: 'welcome' | 'magic-link' | 'verify-email' | 'generic' | 'teacher-approval-needed';
  to?: string;
  subject?: string;
  html?: string;
  // magic-link fields
  token?: string;
  inviteCode?: string;
  roomName?: string;
  // verify-email fields
  studentName?: string;
  // teacher-approval-needed fields
  recordId?: string;
  roomId?: string;
  teacherId?: string;
}

export const emailQueue = new Queue<EmailJobData>('email', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export interface ParentNotificationJobData {
  recordId: string;
}

export const parentQueue = new Queue<ParentNotificationJobData>('parent-notification', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});
