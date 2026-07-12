import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateSession } from './validate-session.js';
import { redisClient, buildSessionKey, buildUserSessionsKey } from './redis-keys.js';
import { SESSION_ABSOLUTE_TTL, SESSION_IDLE_TTL } from './create-session.js';

// Mock redisClient
vi.mock('./redis-keys.js', () => {
  const mockExec = vi.fn();
  const mockMulti = {
    del: vi.fn().mockReturnThis(),
    srem: vi.fn().mockReturnThis(),
    exec: mockExec,
  };
  return {
    redisClient: {
      get: vi.fn(),
      expire: vi.fn(),
      multi: vi.fn(() => mockMulti),
    },
    buildSessionKey: (id) => `session:${id}`,
    buildUserSessionsKey: (id) => `user-sessions:${id}`,
  };
});

describe('validateSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null if session ID is missing', async () => {
    const result = await validateSession(null);
    expect(result).toBeNull();
  });

  it('returns null if session does not exist in Redis', async () => {
    redisClient.get.mockResolvedValueOnce(null);
    const result = await validateSession('non-existent-id');
    expect(result).toBeNull();
    expect(redisClient.get).toHaveBeenCalledWith('session:non-existent-id');
  });

  it('returns null if Redis data is malformed JSON', async () => {
    redisClient.get.mockResolvedValueOnce('invalid-json');
    const result = await validateSession('test-id');
    expect(result).toBeNull();
  });

  it('slides the idle expiration window and returns session data if valid', async () => {
    const now = Date.now();
    const sessionData = { userId: 'user-123', createdAt: now };
    redisClient.get.mockResolvedValueOnce(JSON.stringify(sessionData));
    redisClient.expire.mockResolvedValueOnce('OK');

    const result = await validateSession('valid-id');

    expect(result).toEqual(sessionData);
    expect(redisClient.expire).toHaveBeenCalledWith('session:valid-id', SESSION_IDLE_TTL);
  });

  it('revokes session and returns null if absolute TTL is exceeded', async () => {
    // Fake the time to simulate an old session
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-30T00:00:00Z'));

    const now = Date.now();
    // Create a session that is older than absolute TTL
    const oldCreatedAt = now - (SESSION_ABSOLUTE_TTL + 10) * 1000;
    const sessionData = { userId: 'user-456', createdAt: oldCreatedAt };

    redisClient.get.mockResolvedValueOnce(JSON.stringify(sessionData));

    const result = await validateSession('expired-id');

    expect(result).toBeNull();
    // Should NOT have refreshed idle TTL
    expect(redisClient.expire).not.toHaveBeenCalled();
    // Should have atomically deleted the session
    expect(redisClient.multi).toHaveBeenCalled();
    const mockMulti = redisClient.multi();
    expect(mockMulti.del).toHaveBeenCalledWith('session:expired-id');
    expect(mockMulti.srem).toHaveBeenCalledWith('user-sessions:user-456', 'expired-id');
    expect(mockMulti.exec).toHaveBeenCalled();
  });
});
