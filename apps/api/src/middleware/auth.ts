import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  typ: string;
  iat: number;
  exp: number;
}

// Extend Express Request to carry the verified user identity
declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; typ: string };
    member?: import('@prisma/client').RoomMember;
  }
}

/**
 * Reads the access token from the httpOnly `access_token` cookie,
 * verifies it, and checks that `payload.typ` matches the expected role.
 * Attaches `req.user = { id, typ }` on success.
 * Never trusts a role sent by the client — role comes solely from the token.
 */
export function requireAuth(expectedTyp: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token: string | undefined = req.cookies?.access_token;

    if (!token) {
      res.status(401).json({ error: 'No access token' });
      return;
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }

    if (payload.typ !== expectedTyp) {
      res.status(403).json({ error: 'Forbidden: role mismatch' });
      return;
    }

    req.user = { id: payload.sub, typ: payload.typ };
    next();
  };
}

/**
 * Accepts any of the listed roles (or any authenticated user when no roles are given).
 * Attaches `req.user = { id, typ }` on success.
 */
export function requireAnyAuth(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token: string | undefined = req.cookies?.access_token;
    if (!token) { res.status(401).json({ error: 'No access token' }); return; }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' }); return;
    }

    if (roles.length > 0 && !roles.includes(payload.typ)) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }

    req.user = { id: payload.sub, typ: payload.typ };
    next();
  };
}
