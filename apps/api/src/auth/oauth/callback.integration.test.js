import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';
import { redisClient } from '../sessions/redis-keys.js';
import { emailQueue } from '../../jobs/email-queue.js';

// Mock dependencies since we don't have a real Redis/Postgres in this environment
vi.mock('../../monitoring/queue-dashboard.js', () => ({
  queueDashboardRouter: (req, res, next) => next(),
}));
vi.mock('../../jobs/email-queue.js', () => ({
  emailQueue: {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-123' }),
  },
}));
vi.mock('../../db.js', () => ({
  prisma: {
    user: { findFirst: vi.fn(), create: vi.fn() },
    identity: { findUnique: vi.fn(), create: vi.fn() },
    notificationEvent: { create: vi.fn() },
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
      [null, 'OK'], // get/del or zrem
      [null, 'OK'],
      [null, 1], // zcard or something else
      [null, 'OK'],
      [null, 'OK'],
    ]),
  };
  return {
    redisClient: {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
      multi: vi.fn(() => mockMulti),
    },
    buildSessionKey: vi.fn((id) => `session:${id}`),
    buildUserSessionsKey: vi.fn((id) => `user-sessions:${id}`),
    buildOauthStateKey: vi.fn((state) => `oauth:${state}`),
  };
});

describe('OAuth Callback Integration Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  it('successfully completes the OAuth flow for a new user', async () => {
    // 1. Mock the OAuth state cookie
    const state = 'test-state-abc';
    const codeVerifier = 'test-verifier-xyz';

    // The oauth callback will read state from Redis to validate
    // rate limiter hits multi().exec() returning 4 values.
    // state validation hits multi().get().del().exec() returning 2 values where [0][1] is the JSON string.
    // We can mock multi().exec() implementation based on how it's called, but a simpler way is to
    // just let state get its data from redisClient.get since multi().exec() returns are hard to type conditionally.
    // Wait, state.js uses multi().get().del().exec() and expects results[0][1] to be the string.
    const stateDataStr = JSON.stringify({
      provider: 'google',
      codeVerifier,
      returnTo: 'http://localhost:3000/dashboard',
    });

    redisClient
      .multi()
      .exec.mockResolvedValueOnce([
        [null, 'OK'],
        [null, 'OK'],
        [null, 1],
        [null, 'OK'],
      ]) // 1st call: rate limiter
      .mockResolvedValueOnce([
        [null, stateDataStr],
        [null, 1],
      ]); // 2nd call: state validation

    // 2. Mock Google Token Endpoint
    nock('https://oauth2.googleapis.com').post('/token').reply(200, {
      access_token: 'mock-access-token',
      id_token: 'mock-id-token',
    });

    // 3. Mock Google UserInfo Endpoint
    nock('https://openidconnect.googleapis.com').get('/v1/userinfo').reply(200, {
      sub: 'google-123',
      email: 'newuser@example.com',
      name: 'New User',
      email_verified: true,
    });

    // 4. Mock Database (User and Identity do not exist -> NEW_USER)
    prisma.identity.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValueOnce({ id: '59263bc7-16e2-4b87-9bb9-42c579715fd7' });

    // 5. Execute the request
    const response = await request(app)
      .get(`/auth/google/callback?code=test-code&state=${state}`)
      .set('Cookie', [`oauth_state=${state}`]);

    // 6. Assertions
    // Should result in a redirect to the returnTo URL
    expect(response.status).toBe(302);
    expect(response.header.location).toBe('http://localhost:3000/dashboard');

    // Should set the session cookie
    const setCookieHeader = response.header['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader.some((c) => c.includes('sessionId='))).toBe(true);

    // Verify Prisma was called (to create user/identity)
    expect(prisma.user.create).toHaveBeenCalled();

    // Verify Redis was updated to store the session
    expect(redisClient.multi().set).toHaveBeenCalled();

    // Verify exactly 1 job was enqueued and exactly 1 pending NotificationEvent was created
    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'welcome_email',
          recipientUserId: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
        }),
      }),
    );
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
    expect(emailQueue.add).toHaveBeenCalledWith(
      'welcome_email',
      expect.objectContaining({ userId: '59263bc7-16e2-4b87-9bb9-42c579715fd7' }),
      expect.any(Object),
    );
  });

  it('successfully completes the OAuth flow for a returning user', async () => {
    const state = 'test-state-returning';
    const stateDataStr = JSON.stringify({
      provider: 'google',
      codeVerifier: 'xyz',
      returnTo: 'http://localhost:3000/dashboard',
    });

    redisClient
      .multi()
      .exec.mockResolvedValueOnce([
        [null, 'OK'],
        [null, 'OK'],
        [null, 1],
        [null, 'OK'],
      ]) // rate limiter
      .mockResolvedValueOnce([
        [null, stateDataStr],
        [null, 1],
      ]); // state validation

    nock('https://oauth2.googleapis.com')
      .post('/token')
      .reply(200, { access_token: 't', id_token: 'i' });
    nock('https://openidconnect.googleapis.com').get('/v1/userinfo').reply(200, {
      sub: 'google-old',
      email: 'old@example.com',
      name: 'Old',
      email_verified: true,
    });

    // RETURNING USER mock setup
    prisma.identity.findUnique.mockResolvedValueOnce({
      userId: '60163bc7-16e2-4b87-9bb9-42c579715fd7',
      user: { id: '60163bc7-16e2-4b87-9bb9-42c579715fd7', email: 'old@example.com' },
    });

    const response = await request(app)
      .get(`/auth/google/callback?code=test-code&state=${state}`)
      .set('Cookie', [`oauth_state=${state}`]);

    expect(response.status).toBe(302);
    expect(response.header.location).toBe('http://localhost:3000/dashboard');

    // User creation should NOT be called
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(redisClient.multi().set).toHaveBeenCalled();

    // Verify 0 jobs were enqueued for a returning user
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  it('handles account linking when requested and user declines', async () => {
    // 1. Initial callback -> returns 409 Conflict with Linking prompt
    const state = 'test-state-linking';
    const stateDataStr = JSON.stringify({
      provider: 'google',
      codeVerifier: 'xyz',
      returnTo: '/home',
    });

    redisClient
      .multi()
      .exec.mockResolvedValueOnce([
        [null, 'OK'],
        [null, 'OK'],
        [null, 1],
        [null, 'OK'],
      ]) // rate limiter
      .mockResolvedValueOnce([
        [null, stateDataStr],
        [null, 1],
      ]); // state validation

    nock('https://oauth2.googleapis.com')
      .post('/token')
      .reply(200, { access_token: 't', id_token: 'i' });
    nock('https://openidconnect.googleapis.com').get('/v1/userinfo').reply(200, {
      sub: 'google-conflict',
      email: 'conflict@example.com',
      name: 'Conflict',
      email_verified: true,
    });

    prisma.identity.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'existing-user-123',
      email: 'conflict@example.com',
    });
    redisClient.set.mockResolvedValueOnce('OK'); // for pending link

    const callbackResponse = await request(app)
      .get(`/auth/google/callback?code=test-code&state=${state}`)
      .set('Cookie', [`oauth_state=${state}`]);

    // Expected behavior for conflict is a redirect to the linking page with returnTo in query
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.header.location).toContain('/auth/link');

    const linkingToken = 'fake-linking-token';

    // 2. Decline linking -> clears cookies, creates nothing
    const pendingLinkData = JSON.stringify({
      targetUserId: 'existing-user-123',
      profile: { provider: 'google', providerId: 'google-conflict' },
    });

    redisClient.multi().exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
      [null, 1],
      [null, 'OK'],
    ]); // rate limiter for /linking/confirm
    redisClient.get.mockResolvedValueOnce(pendingLinkData);

    const declineResponse = await request(app)
      .post('/auth/linking/confirm')
      .set('Cookie', [`pending_linking_token=${linkingToken}`])
      .send({ action: 'decline' });

    expect(declineResponse.status).toBe(200);
    expect(declineResponse.body.success).toBe(false);
  });

  it('handles account linking when requested and user confirms', async () => {
    // Decline test covered 409. Let's just test the /linking/confirm endpoint with confirm: true
    const linkingToken = 'some-valid-token';
    const pendingLinkData = JSON.stringify({
      targetUserId: 'existing-user-123',
      profile: { provider: 'google', providerId: 'google-conflict' },
    });

    redisClient.multi().exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
      [null, 1],
      [null, 'OK'],
    ]); // rate limiter

    redisClient.get.mockResolvedValueOnce(pendingLinkData);
    prisma.identity.create.mockResolvedValueOnce({});

    const confirmResponse = await request(app)
      .post('/auth/linking/confirm')
      .set('Cookie', [`pending_linking_token=${linkingToken}`])
      .send({ action: 'confirm' });

    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.success).toBe(true);

    // Should set session cookie
    const setCookieHeader = confirmResponse.header['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    expect(prisma.identity.create).toHaveBeenCalled();
  });

  it('returns 401 for /me endpoint if unauthenticated', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user data for /me endpoint if authenticated', async () => {
    // Our authenticate middleware checks Redis for session validity
    redisClient.get.mockResolvedValueOnce(
      JSON.stringify({ userId: 'valid-user-123', createdAt: Date.now() }),
    );

    prisma.user.findUnique = vi.fn().mockResolvedValueOnce({
      id: 'valid-user-123',
      email: 'user@example.com',
      displayName: 'Test User',
      avatarUrl: null,
    });

    const res = await request(app).get('/auth/me').set('Cookie', ['sessionId=valid-session-id']);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('valid-user-123');
    expect(res.body.email).toBe('user@example.com');
  });
});
