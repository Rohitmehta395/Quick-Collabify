import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveIdentity, IdentityResultType } from './resolve-identity.js';
import { prisma } from '../../db.js';

// Mock Prisma
vi.mock('../../db.js', () => {
  return {
    prisma: {
      identity: {
        findUnique: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
    },
  };
});

describe('resolveIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns RETURNING_USER if identity exists and matches the current session', async () => {
    const mockUser = { id: 'user-1' };
    const mockIdentity = { userId: 'user-1', user: mockUser };

    prisma.identity.findUnique.mockResolvedValueOnce(mockIdentity);

    const result = await resolveIdentity('google', 'g123', 'test@test.com', 'user-1');

    expect(result.type).toBe(IdentityResultType.RETURNING_USER);
    expect(result.user).toEqual(mockUser);
    expect(result.identity).toEqual(mockIdentity);
  });

  it('returns RETURNING_USER if identity exists and no session is provided', async () => {
    const mockUser = { id: 'user-2' };
    const mockIdentity = { userId: 'user-2', user: mockUser };

    prisma.identity.findUnique.mockResolvedValueOnce(mockIdentity);

    const result = await resolveIdentity('google', 'g123', 'test@test.com', null);

    expect(result.type).toBe(IdentityResultType.RETURNING_USER);
    expect(result.user).toEqual(mockUser);
    expect(result.identity).toEqual(mockIdentity);
  });

  it('returns CONFLICTING_IDENTITY if identity is claimed by another user', async () => {
    const mockUser = { id: 'user-another' };
    const mockIdentity = { userId: 'user-another', user: mockUser };

    prisma.identity.findUnique.mockResolvedValueOnce(mockIdentity);

    // Current user is 'user-1', but identity belongs to 'user-another'
    const result = await resolveIdentity('google', 'g123', 'test@test.com', 'user-1');

    expect(result.type).toBe(IdentityResultType.CONFLICTING_IDENTITY);
  });

  it('returns LINKING_CANDIDATE if no identity exists but user email matches', async () => {
    prisma.identity.findUnique.mockResolvedValueOnce(null);
    const mockUser = { id: 'user-3', email: 'test@test.com' };
    prisma.user.findFirst.mockResolvedValueOnce(mockUser);

    const result = await resolveIdentity('google', 'g123', 'test@test.com', null);

    expect(result.type).toBe(IdentityResultType.LINKING_CANDIDATE);
    expect(result.user).toEqual(mockUser);
    expect(result.identity).toBeNull();
  });

  it('returns NEW_USER if neither identity nor user email exists', async () => {
    prisma.identity.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(null);

    const result = await resolveIdentity('google', 'g123', 'test@test.com', null);

    expect(result.type).toBe(IdentityResultType.NEW_USER);
    expect(result.user).toBeNull();
    expect(result.identity).toBeNull();
  });
});
