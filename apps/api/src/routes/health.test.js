import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../app.js';

vi.mock('../db.js', () => ({
  prisma: {},
}));

vi.mock('../auth/sessions/redis-keys.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
    multi: vi.fn(() => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  },
  buildSessionKey: vi.fn(),
  buildUserSessionsKey: vi.fn(),
  buildOauthStateKey: vi.fn(),
}));

describe('GET /health', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const app = buildApp();
    return new Promise((resolve) => {
      // Listen on port 0 to allocate an ephemeral port
      server = app.listen(0, () => {
        const address = server.address();
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it('should return 200 OK and status "ok"', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
  });
});
