import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // required by BullMQ
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err);
});

export default redis;
