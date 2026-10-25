import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { apiReference } from '@scalar/express-api-reference';
import { openApiSpec } from './docs/openapi';
import authRouter from './routes/auth';
import roomsRouter from './routes/rooms';
import studentAuthRouter from './routes/studentAuth';
import sessionsRouter, { sessionsRoomRouter } from './routes/sessions';
import scanRouter from './routes/scan';
import manualRouter from './routes/manual';
import { roomSessionsRouter, sessionRecordsRouter } from './routes/dashboard';
import backgroundRouter, { PRESETS, adminDeleteBackground } from './routes/background';
import { requireAuth, requireAnyAuth } from './middleware/auth';
import * as mailerLib from './lib/mailer';
import { createEmailWorker } from './workers/emailWorker';
import { createMagicLinkWorker } from './workers/magicLinkWorker';
import { scheduleRetentionCleanup } from './jobs/retentionCleanup';
import studentAttendanceRouter from './routes/studentAttendance';
import joinRouter from './routes/join';

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true }));
app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    skip: () => process.env.NODE_ENV === 'test',
  }),
);
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// ─── OpenAPI & Scalar API Documentation ───────────────────────────────────────

app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

app.use(
  '/reference',
  apiReference({
    pageTitle: 'TangkayScan API Reference',
    spec: {
      content: openApiSpec,
    },
    theme: 'purple',
    layout: 'modern',
    darkMode: true,
  }),
);

app.get('/docs', (_req: Request, res: Response) => {
  res.redirect('/reference');
});

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
app.use('/api/rooms/:id/join', joinRouter);
app.use('/api/rooms/:id', backgroundRouter);
app.use('/api/student', studentAttendanceRouter);

// ─── GET /api/presets — public preset list ────────────────────────────────────

app.get('/api/presets', (_req, res) => {
  res.json(PRESETS);
});

// ─── DELETE /api/admin/rooms/:id/background — teacher admin background removal ─

app.delete('/api/admin/rooms/:id/background', requireAuth('teacher'), adminDeleteBackground);

// ─── GET /api/uploads/selfies/:filename — auth-gated selfie serving ───────────

app.get(
  '/api/uploads/selfies/:filename',
  requireAnyAuth('teacher', 'student'),
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
  requireAnyAuth('teacher', 'student'),
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

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

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
    console.log(`[api] docs available at http://localhost:${PORT}/reference`);
  });
}

export default app;
