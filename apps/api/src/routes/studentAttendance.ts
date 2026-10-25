import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

// Returns the start of the ISO week (Monday) for the given date
function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1 - day); // adjust to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── GET /api/student/my-attendance-summary — student-auth ──────────────────

router.get('/my-attendance-summary', requireAuth('student'), async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;

  const records = await prisma.attendanceRecord.findMany({
    where: { student_id: studentId, approval_status: 'approved' },
    include: { session: { include: { room: { select: { id: true, name: true } } } } },
    orderBy: { scanned_at: 'desc' },
  });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthCount = records.filter((r) => new Date(r.scanned_at) >= startOfMonth).length;

  // Compute current streak: consecutive days with at least one approved record
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  for (let i = 0; i < 365; i++) {
    const dayStart = new Date(today.getTime() - i * dayMs);
    const dayEnd = new Date(dayStart.getTime() + dayMs);
    const found = records.some((r) => {
      const d = new Date(r.scanned_at);
      return d >= dayStart && d < dayEnd;
    });
    if (found) streak++;
    else if (i > 0) break; // allow today to be absent before counting streak
  }

  res.json({
    total: records.length,
    thisMonth: thisMonthCount,
    streak,
    recentRecords: records.slice(0, 20).map((r) => ({
      id: r.id,
      session_id: r.session_id,
      method: r.method,
      approval_status: r.approval_status,
      location_flag: r.location_flag,
      risk_score: r.risk_score,
      scanned_at: r.scanned_at,
      room: r.session.room,
    })),
  });
});

// ─── GET /api/student/my-attendance — student-auth ───────────────────────────

router.get('/my-attendance', requireAuth('student'), async (req: Request, res: Response): Promise<void> => {
  const weekStart = startOfWeekMonday(new Date());
  const records = await prisma.attendanceRecord.findMany({
    where: {
      student_id: req.user!.id,
      scanned_at: { gte: weekStart },
    },
    include: { session: { include: { room: true } } },
    orderBy: { scanned_at: 'asc' },
  });
  res.json(records);
});

export default router;
