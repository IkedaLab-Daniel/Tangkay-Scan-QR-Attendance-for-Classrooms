import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { prisma } from '../lib/prisma';

export async function runRetentionCleanup(): Promise<{
  deletedFiles: number;
  nullifiedRecords: number;
}> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const records = await prisma.attendanceRecord.findMany({
    where: {
      scanned_at: { lt: cutoff },
      OR: [
        { selfie_url: { not: null } },
        { student_lat: { not: null } },
        { student_lng: { not: null } },
      ],
    },
    select: { id: true, selfie_url: true },
  });

  let deletedFiles = 0;

  for (const record of records) {
    if (record.selfie_url) {
      const filePath = path.join(process.cwd(), 'uploads', 'selfies', path.basename(record.selfie_url));
      try {
        fs.unlinkSync(filePath);
        deletedFiles++;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        // ENOENT — file already gone, continue
      }
    }
  }

  const ids = records.map((r) => r.id);

  if (ids.length > 0) {
    await prisma.attendanceRecord.updateMany({
      where: { id: { in: ids } },
      data: {
        selfie_url: null,
        student_lat: null,
        student_lng: null,
        student_accuracy: null,
        gps_readings: [],
      },
    });
  }

  const nullifiedRecords = ids.length;
  console.log(`Retention cleanup: deleted ${deletedFiles} files, nullified ${nullifiedRecords} records`);
  return { deletedFiles, nullifiedRecords };
}

export function scheduleRetentionCleanup(): void {
  if (process.env.NODE_ENV === 'test') return;
  cron.schedule('0 2 * * *', () => {
    runRetentionCleanup().catch((err) => {
      console.error('[retentionCleanup] Error during cleanup:', err);
    });
  });
}
