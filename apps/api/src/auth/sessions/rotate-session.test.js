import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rotateSession } from './rotate-session.js';
import { createSession } from './create-session.js';
import { revokeSession } from './revoke-session.js';

// Mock dependencies
vi.mock('./create-session.js', () => ({
  createSession: vi.fn(),
}));

vi.mock('./revoke-session.js', () => ({
  revokeSession: vi.fn(),
}));

describe('rotateSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new session and revokes the old one', async () => {
    createSession.mockResolvedValueOnce({ sessionId: 'new-id', createdAt: 12345 });
    revokeSession.mockResolvedValueOnce(undefined);

    const result = await rotateSession('user-1', 'old-id');

    expect(createSession).toHaveBeenCalledWith('user-1');
    expect(revokeSession).toHaveBeenCalledWith('user-1', 'old-id');
    expect(result).toEqual({ newSessionId: 'new-id', createdAt: 12345 });
  });

  it('allows new session to persist if revoke fails', async () => {
    createSession.mockResolvedValueOnce({ sessionId: 'new-id', createdAt: 12345 });
    revokeSession.mockRejectedValueOnce(new Error('Redis is down'));

    const result = await rotateSession('user-1', 'old-id');

    expect(createSession).toHaveBeenCalledWith('user-1');
    expect(revokeSession).toHaveBeenCalledWith('user-1', 'old-id');
    expect(result).toEqual({ newSessionId: 'new-id', createdAt: 12345 });
  });

  it('throws an error if createSession fails', async () => {
    createSession.mockRejectedValueOnce(new Error('Creation failed'));

    await expect(rotateSession('user-1', 'old-id')).rejects.toThrow('Creation failed');
    // Ensure revoke is NEVER called if create fails
    expect(revokeSession).not.toHaveBeenCalled();
  });
});
