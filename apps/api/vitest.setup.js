import { vi } from 'vitest';

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.OAUTH_GOOGLE_CLIENT_ID = 'test-google-id';
process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.OAUTH_GOOGLE_REDIRECT_URI = 'http://localhost:4000/auth/google/callback';
process.env.OAUTH_GITHUB_CLIENT_ID = 'test-github-id';
process.env.OAUTH_GITHUB_CLIENT_SECRET = 'test-github-secret';
process.env.OAUTH_GITHUB_REDIRECT_URI = 'http://localhost:4000/auth/github/callback';

// Prevent actual Redis connections during tests globally
vi.mock('ioredis', () => {
  class Redis {
    constructor() {
      this.get = vi.fn();
      this.set = vi.fn();
      this.del = vi.fn();
      this.expire = vi.fn();
      this.multi = vi.fn(() => ({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, 'OK']]),
      }));
      this.on = vi.fn();
    }
  }
  return { Redis, default: Redis };
});
