import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
  // Upstash (and any rediss:// URL) requires TLS — local redis:// does not
  ...(redisUrl.startsWith('rediss://') ? { tls: {} } : {}),
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err);
});

export default redis;
