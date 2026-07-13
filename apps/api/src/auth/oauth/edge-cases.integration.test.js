import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { buildApp } from '../../app.js';
import { redisClient } from '../sessions/redis-keys.js';
import { prisma } from '../../db.js';

vi.mock('../../db.js', () => ({
  prisma: {
    user: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    identity: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../sessions/redis-keys.js', () => {
  const mockMulti = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    pexpire: vi.fn().mockReturnThis(),
    sadd: vi.fn().mockReturnThis(),
    srem: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 'OK'],
      [null, 'OK'],
      [null, 1], // Rate limit count
      [null, 'OK'],
    ]),
  };

  return {
    redisClient: {
      get: vi.fn(),
      set: vi.fn(),
      expire: vi.fn(),
      multi: vi.fn(() => mockMulti),
    },
    buildSessionKey: vi.fn((id) => `session:${id}`),
    buildUserSessionsKey: vi.fn((id) => `user-sessions:${id}`),
    buildOauthStateKey: vi.fn((state) => `oauth:${state}`),
  };
});

describe('OAuth Edge Case Integration Tests (Spec §14.6)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  it('handles consent denial (error returned to callback)', async () => {
    const res = await request(app)
      .get('/auth/google/callback?error=access_denied&state=some-state')
      .set('Cookie', ['oauth_state=some-state']);

    // Should map the error to OAUTH_ERROR 400
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OAUTH_ERROR');
    expect(res.body.error.message).toContain('access_denied');
  });

  it('handles missing (not just unverified) email in provider payload', async () => {
    const state = 'test-state-missing-email';
    const stateDataStr = JSON.stringify({
      provider: 'google',
      codeVerifier: 'xyz',
      returnTo: null,
    });

    redisClient.multi().exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
      [null, 1],
      [null, 'OK'],
    ]);
    redisClient.multi().exec.mockResolvedValueOnce([
      [null, stateDataStr],
      [null, 1],
    ]);

    nock('https://oauth2.googleapis.com').post('/token').reply(200, {
      access_token: 'mock-access-token',
      id_token: 'mock-id-token',
      expires_in: 3600,
    });

    nock('https://openidconnect.googleapis.com').get('/v1/userinfo').reply(200, {
      sub: 'google-123',
      // Notice: email is completely omitted
      name: 'No Email User',
    });

    const res = await request(app)
      .get(`/auth/google/callback?code=test-code&state=${state}`)
      .set('Cookie', [`oauth_state=${state}`]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNVERIFIED_EMAIL');
    expect(res.body.error.message).toContain('verify your email');
  });

  it('handles network timeout mid-callback gracefully', async () => {
    const state = 'test-state-timeout';
    const stateDataStr = JSON.stringify({
      provider: 'google',
      codeVerifier: 'xyz',
      returnTo: null,
    });

    redisClient.multi().exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
      [null, 1],
      [null, 'OK'],
    ]);
    redisClient.multi().exec.mockResolvedValueOnce([
      [null, stateDataStr],
      [null, 1],
    ]);

    // Simulate a network timeout or connection reset from the provider
    nock('https://oauth2.googleapis.com')
      .post('/token')
      .replyWithError({ code: 'ETIMEDOUT', message: 'Connection timed out' });

    const res = await request(app)
      .get(`/auth/google/callback?code=test-code&state=${state}`)
      .set('Cookie', [`oauth_state=${state}`]);

    // It should hit the global error handler as an unhandled promise rejection/fetch error (500)
    // or if we map it specifically, a 502/504. In default Express setup, it becomes 500.
    expect(res.status).toBeGreaterThanOrEqual(400); // 500 is typical for unhandled network errors
  });

  it('handles double-submission race on reused authorization code', async () => {
    const state = 'test-state-double';

    // On the first submission, state validation deletes the state.
    // On the second concurrent submission, the state will already be null.
    // We simulate the SECOND submission by having Redis return null for the state.
    redisClient.multi().exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
      [null, 1],
      [null, 'OK'],
    ]);
    redisClient.multi().exec.mockResolvedValueOnce([
      [null, null],
      [null, 1],
    ]); // State already deleted

    const res = await request(app)
      .get(`/auth/google/callback?code=reused-code&state=${state}`)
      .set('Cookie', [`oauth_state=${state}`]);

    // It should reject immediately because the state is invalid/missing (already consumed)
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('maintains existing session validity even during provider outage', async () => {
    // If Google is down, our existing sessions should still work perfectly.
    // Ensure external network requests fail, but allow localhost for supertest.
    nock.disableNetConnect();
    nock.enableNetConnect(/(localhost|127\.0\.0\.1)/);
    nock('https://oauth2.googleapis.com').post('/token').replyWithError('Provider Down');

    // Mock validateSession to return a valid session
    redisClient.get.mockResolvedValueOnce(
      JSON.stringify({
        userId: 'test-user-123',
        createdAt: Date.now(),
      }),
    );

    // Mock the user existing in the DB
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'test-user-123',
      email: 'test@example.com',
      displayName: 'Test User',
    });

    const res = await request(app).get('/auth/me').set('Cookie', ['sessionId=valid-session-id']);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('test-user-123');

    // Re-enable net connect for other tests
    nock.enableNetConnect();
  });
});
