// Load test environment variables before any module import
process.env.DATABASE_URL = 'postgresql://markdanielcallejas@localhost:5432/tangkayscan';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-ok!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars!';
process.env.NODE_ENV = 'test';
