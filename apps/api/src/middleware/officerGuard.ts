import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Factory middleware: verifies the requesting student is an officer of the room.
 *
 * - Reads `req.user.id` (student id from JWT — set by `requireAuth('student')`)
 * - Looks up `room_members` where `student_id = req.user.id AND room_id = req.params[roomIdParam] AND role = 'officer'`
 * - On success: attaches the `RoomMember` row to `req.member` and calls `next()`
 * - On failure: responds with 403
 *
 * Must be used AFTER `requireAuth('student')`.
 */
export function requireOfficer(roomIdParam = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const studentId = req.user!.id;
    const roomId = req.params[roomIdParam];

    const member = await prisma.roomMember.findFirst({
      where: {
        student_id: studentId,
        room_id: roomId,
        role: 'officer',
      },
    });

    if (!member) {
      res.status(403).json({ error: 'Forbidden: officer role required' });
      return;
    }

    req.member = member;
    next();
  };
}
