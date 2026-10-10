import { customAlphabet } from 'nanoid';
import redis from './redis';
import { broadcast } from './sseManager';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 16);

// Module-level map of active rotation intervals
const activeIntervals = new Map<string, ReturnType<typeof setInterval>>();

function currentTokenKey(sessionId: string): string {
  return `session:${sessionId}:current_token`;
}

function prevTokenKey(sessionId: string): string {
  return `session:${sessionId}:prev_token`;
}

async function rotate(sessionId: string): Promise<string> {
  const token = nanoid();
  const expiresAt = new Date(Date.now() + 30_000).toISOString();

  // Move current → prev (35s grace for in-flight scans)
  const currentKey = currentTokenKey(sessionId);
  const prevKey = prevTokenKey(sessionId);

  const existing = await redis.get(currentKey);
  if (existing) {
    await redis.set(prevKey, existing, 'EX', 35);
  }

  await redis.set(currentKey, token, 'EX', 30);

  broadcast(sessionId, { token, expiresAt });

  return token;
}

/**
 * Starts the 30-second rotation cycle for a session.
 * Writes the initial token into Redis immediately, then repeats every 30s.
 * Returns the first token.
 */
export async function startRotation(sessionId: string): Promise<string> {
  // Clear any existing interval for this session
  stopRotation(sessionId);

  const token = await rotate(sessionId);

  const interval = setInterval(() => {
    rotate(sessionId).catch((err) =>
      console.error(`[tokenRotator] rotation error for session ${sessionId}:`, err),
    );
  }, 30_000);

  activeIntervals.set(sessionId, interval);

  return token;
}

/**
 * Stops the rotation, deletes both Redis keys, and broadcasts { ended: true }.
 */
export function stopRotation(sessionId: string): void {
  const interval = activeIntervals.get(sessionId);
  if (interval !== undefined) {
    clearInterval(interval);
    activeIntervals.delete(sessionId);
  }

  // Fire-and-forget cleanup
  redis.del(currentTokenKey(sessionId), prevTokenKey(sessionId)).catch(() => {});
  broadcast(sessionId, { ended: true });
}

/**
 * Stops all active rotation intervals (for test cleanup).
 */
export function stopAll(): void {
  for (const [sessionId] of activeIntervals) {
    stopRotation(sessionId);
  }
}

export async function getCurrentToken(sessionId: string): Promise<string | null> {
  return redis.get(currentTokenKey(sessionId));
}

export async function getPrevToken(sessionId: string): Promise<string | null> {
  return redis.get(prevTokenKey(sessionId));
}
