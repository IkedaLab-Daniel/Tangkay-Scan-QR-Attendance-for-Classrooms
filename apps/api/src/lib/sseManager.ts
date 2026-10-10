import { Response } from 'express';

// Per-session set of open SSE response objects
const sessions = new Map<string, Set<Response>>();

/**
 * Subscribe a client to a session's SSE stream.
 * Sets the required SSE headers and cleans up when the connection closes.
 */
export function subscribe(sessionId: string, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Client should retry after 5s if the connection drops
  res.write('retry: 5000\n\n');

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Set());
  }
  sessions.get(sessionId)!.add(res);

  res.on('close', () => {
    const set = sessions.get(sessionId);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        sessions.delete(sessionId);
      }
    }
  });
}

/**
 * Broadcast a JSON payload to all SSE subscribers of a session.
 */
export function broadcast(sessionId: string, data: object): void {
  const set = sessions.get(sessionId);
  if (!set || set.size === 0) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
}

/**
 * Returns the number of active SSE subscribers for a session.
 */
export function getSubscriberCount(sessionId: string): number {
  return sessions.get(sessionId)?.size ?? 0;
}

/**
 * Removes the session's subscriber set (call after session ends).
 */
export function cleanup(sessionId: string): void {
  sessions.delete(sessionId);
}
