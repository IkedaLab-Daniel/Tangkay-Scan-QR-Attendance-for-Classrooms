import 'dotenv/config';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import authRouter from './routes/auth';
import roomsRouter from './routes/rooms';
import studentAuthRouter from './routes/studentAuth';
import sessionsRouter, { sessionsRoomRouter } from './routes/sessions';
import scanRouter from './routes/scan';
import manualRouter from './routes/manual';
import { roomSessionsRouter, sessionRecordsRouter } from './routes/dashboard';
import backgroundRouter, { PRESETS, adminDeleteBackground } from './routes/background';
import { requireAuth } from './middleware/auth';
import * as mailerLib from './lib/mailer';
import { createEmailWorker } from './workers/emailWorker';
import { createMagicLinkWorker } from './workers/magicLinkWorker';
import { scheduleRetentionCleanup } from './jobs/retentionCleanup';
import studentAttendanceRouter from './routes/studentAttendance';


const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/auth/student', studentAuthRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/rooms/:id', sessionsRoomRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions', scanRouter);
app.use('/api/sessions', manualRouter);
app.use('/api/rooms/:id', roomSessionsRouter);
app.use('/api/sessions', sessionRecordsRouter);
app.use('/api/rooms/:id', backgroundRouter);
app.use('/api/student', studentAttendanceRouter);


// ─── GET /api/presets — public preset list ────────────────────────────────────

app.get('/api/presets', (_req, res) => {
  res.json(PRESETS);
});

// ─── DELETE /api/admin/rooms/:id/background — teacher admin background removal ─

app.delete(
  '/api/admin/rooms/:id/background',
  requireAuth('teacher'),
  adminDeleteBackground,
);

// ─── GET /api/uploads/selfies/:filename — auth-gated selfie serving ───────────

app.get(
  '/api/uploads/selfies/:filename',
  (req: Request, res: Response, next) => {
    const token: string | undefined = req.cookies?.access_token;
    if (!token) {
      res.status(401).json({ error: 'No access token' });
      return;
    }
    let payload: { sub: string; typ: string };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      payload = jwt.verify(token, process.env.JWT_SECRET as string) as { sub: string; typ: string };
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }
    if (payload.typ !== 'teacher' && payload.typ !== 'student') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  (req: Request, res: Response): void => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(process.cwd(), 'uploads', 'selfies', filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.sendFile(filePath);
  },
);

// ─── GET /api/uploads/manual/:filename — auth-gated file serving ──────────────

app.get(
  '/api/uploads/manual/:filename',
  (req: Request, res: Response, next) => {
    // Allow teacher or officer (student) — check token typ first, then serve
    const token: string | undefined = req.cookies?.access_token;
    if (!token) {
      res.status(401).json({ error: 'No access token' });
      return;
    }
    let payload: { sub: string; typ: string };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      payload = jwt.verify(token, process.env.JWT_SECRET as string) as { sub: string; typ: string };
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }
    if (payload.typ !== 'teacher' && payload.typ !== 'student') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  (req: Request, res: Response): void => {
    const filename = path.basename(req.params.filename); // sanitise — no path traversal
    const filePath = path.join(process.cwd(), 'uploads', 'manual', filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.sendFile(filePath);
  },
);

if (require.main === module) {
  // Start email workers (skip in test to avoid opening SMTP/Redis connections)
  if (process.env.NODE_ENV !== 'test') {
    mailerLib.verifyConnection();
    createEmailWorker();
    createMagicLinkWorker();
    scheduleRetentionCleanup();
  }

  app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
  });
}

export default app;
