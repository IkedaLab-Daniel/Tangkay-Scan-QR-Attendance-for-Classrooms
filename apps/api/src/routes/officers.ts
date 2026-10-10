import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

const router = Router({ mergeParams: true });
const prisma = new PrismaClient();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const assignOfficerSchema = z.object({
  memberId: z.string().min(1),
  officerTitle: z.string().min(1).max(50),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify the room exists and belongs to the requesting teacher.
 * Returns the room or sends an error response and returns null.
 */
async function verifyRoomOwnership(
  req: Request,
  res: Response,
): Promise<boolean> {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });

  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return false;
  }

  if (room.teacher_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }

  return true;
}

// ─── POST /api/rooms/:id/officers ─────────────────────────────────────────────

router.post('/', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  const parsed = assignOfficerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  if (!(await verifyRoomOwnership(req, res))) return;

  const { memberId, officerTitle } = parsed.data;

  // Verify the member belongs to this room
  const existing = await prisma.roomMember.findFirst({
    where: { id: memberId, room_id: req.params.id },
  });

  if (!existing) {
    res.status(404).json({ error: 'Member not found in this room' });
    return;
  }

  const updated = await prisma.roomMember.update({
    where: { id: memberId },
    data: { role: 'officer', officer_title: officerTitle },
    include: { student: { select: { id: true, name: true, email: true } } },
  });

  res.json(updated);
});

// ─── DELETE /api/rooms/:id/officers/:memberId ─────────────────────────────────

router.delete('/:memberId', requireAuth('teacher'), async (req: Request, res: Response): Promise<void> => {
  if (!(await verifyRoomOwnership(req, res))) return;

  const existing = await prisma.roomMember.findFirst({
    where: { id: req.params.memberId, room_id: req.params.id },
  });

  if (!existing) {
    res.status(404).json({ error: 'Member not found in this room' });
    return;
  }

  const updated = await prisma.roomMember.update({
    where: { id: req.params.memberId },
    data: { role: 'student', officer_title: null },
    include: { student: { select: { id: true, name: true, email: true } } },
  });

  res.json(updated);
});

export default router;
