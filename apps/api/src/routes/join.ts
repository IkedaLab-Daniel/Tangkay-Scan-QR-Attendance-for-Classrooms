import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

const router = Router({ mergeParams: true });
const prisma = new PrismaClient();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const consentSchema = z.object({
  status: z.enum(['granted', 'denied']),
});

// ─── POST /api/rooms/:id/join ─────────────────────────────────────────────────

router.post('/', requireAuth('student'), async (req: Request, res: Response): Promise<void> => {
  const roomId = req.params.id;
  const studentId = req.user!.id;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  const existing = await prisma.roomMember.findUnique({
    where: { room_id_student_id: { room_id: roomId, student_id: studentId } },
  });
  if (existing) {
    res.status(409).json({ error: 'Already a member of this room' });
    return;
  }

  const member = await prisma.roomMember.create({
    data: {
      room_id: roomId,
      student_id: studentId,
      role: 'student',
    },
  });

  res.status(201).json(member);
});

// ─── POST /api/rooms/:id/consent ─────────────────────────────────────────────

router.post('/consent', requireAuth('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const roomId = req.params.id;
  const studentId = req.user!.id;
  const { status } = parsed.data;

  const member = await prisma.roomMember.findUnique({
    where: { room_id_student_id: { room_id: roomId, student_id: studentId } },
  });
  if (!member) {
    res.status(404).json({ error: 'Not a member of this room' });
    return;
  }

  // No consent_status on RoomMember — consent lives on Student
  // If denied, update student's global consent_status
  if (status === 'denied') {
    await prisma.student.update({
      where: { id: studentId },
      data: { consent_status: 'denied' },
    });
  } else {
    await prisma.student.update({
      where: { id: studentId },
      data: { consent_status: 'granted' },
    });
  }

  res.json({ ok: true, status });
});

export default router;
