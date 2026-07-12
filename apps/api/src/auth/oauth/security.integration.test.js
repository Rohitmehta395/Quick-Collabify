import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { buildApp } from '../../app.js';
import { redisClient } from '../sessions/redis-keys.js';
import { prisma } from '../../db.js';

// Mock dependencies
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
      multi: vi.fn(() => mockMulti),
    },
    buildSessionKey: vi.fn((id) => `session:${id}`),
    buildUserSessionsKey: vi.fn((id) => `user-sessions:${id}`),
    buildOauthStateKey: vi.fn((state) => `oauth:${state}`),
  };
});

describe('OAuth Security Integration Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Session Validation & Identical 401s (Spec §11.6)', () => {
    it('returns 401 UNAUTHORIZED when no session cookie is provided', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Unauthorized');
    });

    it('returns identical 401 UNAUTHORIZED when session cookie is tampered/invalid', async () => {
      // Mock validateSession to return null (session not found)
      redisClient.get.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', ['sessionId=tampered-session-id']);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Unauthorized');
    });

    it('returns identical 401 UNAUTHORIZED when session is expired (idle TTL elapsed)', async () => {
      // Mock validateSession to return null (idle expired)
      redisClient.get.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', ['sessionId=expired-session-id']);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Unauthorized');
    });

    it('returns identical 401 UNAUTHORIZED when session absolute TTL elapsed', async () => {
      // Absolute TTL exceeded
      redisClient.get.mockResolvedValueOnce(
        JSON.stringify({
          userId: 'test-user',
          createdAt: Date.now() - 100 * 60 * 60 * 1000, // 100 hours ago
        }),
      );

      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', ['sessionId=expired-absolute-session-id']);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Unauthorized');
    });
  });

  describe('State & CSRF Protection', () => {
    it('rejects the flow if state cookie is missing (CSRF attempt)', async () => {
      // Rate limiter mock setup is default
      const res = await request(app).get('/auth/google/callback?code=test-code&state=some-state');
      // Notice: no oauth_state cookie provided

      expect(res.status).toBe(400); // Invalid request
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('rejects the flow if state query parameter does not match the state cookie', async () => {
      const res = await request(app)
        .get('/auth/google/callback?code=test-code&state=malicious-state')
        .set('Cookie', ['oauth_state=legit-state']);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('rejects the flow if state is valid but expired/deleted from Redis', async () => {
      // Rate limiter passes
      redisClient
        .multi()
        .exec.mockResolvedValueOnce([
          [null, 'OK'],
          [null, 'OK'],
          [null, 1],
          [null, 'OK'],
        ])
        // State validation hits Redis (multi().get().del().exec()) -> returns null for the state string
        .mockResolvedValueOnce([
          [null, null],
          [null, 1],
        ]);

      const res = await request(app)
        .get('/auth/google/callback?code=test-code&state=expired-state')
        .set('Cookie', ['oauth_state=expired-state']);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('rejects the flow if PKCE code verifier validation fails with provider', async () => {
      const state = 'test-state-pkce';
      const stateDataStr = JSON.stringify({
        provider: 'google',
        codeVerifier: 'invalid-pkce-verifier',
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

      // Simulate Google rejecting the invalid PKCE verifier during token exchange
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(400, { error: 'invalid_grant', error_description: 'Bad Request' });

      const res = await request(app)
        .get(`/auth/google/callback?code=test-code&state=${state}`)
        .set('Cookie', [`oauth_state=${state}`]);

      // Expect the API to handle the OAuth2RequestError gracefully and return a 400 Bad Request
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PROVIDER_ERROR');
    });
  });

  describe('Session Fixation (Spec §14.5)', () => {
    it('issues a completely new session ID upon successful authentication, ignoring any prior session cookie', async () => {
      const state = 'test-state-fixation';
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

      prisma.identity.findUnique.mockResolvedValueOnce({
        userId: 'old-user-123',
        user: { id: 'old-user-123', email: 'old@example.com' },
      });

      // Mock successful Google login
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(200, {
          access_token: 'mock-access-token',
          id_token: 'mock-id-token',
          expires_in: 3600,
        });
      nock('https://openidconnect.googleapis.com')
        .get('/v1/userinfo')
        .reply(200, {
          sub: 'google-123',
          email: 'old@example.com',
          email_verified: true,
          name: 'Old User',
        });

      // We pass an existing attacker-provided session ID
      const res = await request(app)
        .get(`/auth/google/callback?code=test-code&state=${state}`)
        .set('Cookie', [`oauth_state=${state}`, 'sessionId=attacker-controlled-session']);

      expect(res.status).toBe(302);

      const cookies = res.header['set-cookie'];
      expect(cookies).toBeDefined();

      const sessionCookie = cookies.find((c) => c.startsWith('sessionId='));
      expect(sessionCookie).toBeDefined();

      // The new session ID must NOT be the attacker-controlled one
      expect(sessionCookie).not.toContain('attacker-controlled-session');
    });
  });

  describe('Open Redirect Rejection (Spec §11.1)', () => {
    function mockGoogleOAuth() {
      nock('https://oauth2.googleapis.com').post('/token').reply(200, {
        access_token: 'mock-access-token',
        id_token: 'mock-id-token',
        expires_in: 3600,
      });

      nock('https://openidconnect.googleapis.com').get('/v1/userinfo').reply(200, {
        sub: 'google-123',
        email: 'old@example.com',
        email_verified: true,
        name: 'Old User',
      });
    }

    it('defaults to safe redirect when missing returnTo parameter', async () => {
      const state = 'test-state-no-returnto';
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

      prisma.identity.findUnique.mockResolvedValueOnce({
        userId: 'old-user-123',
        user: { id: 'old-user-123', email: 'old@example.com' },
      });

      mockGoogleOAuth();

      const res = await request(app)
        .get(`/auth/google/callback?code=test-code&state=${state}`)
        .set('Cookie', [`oauth_state=${state}`]);

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('http://localhost:3000/');
    });

    it('accepts safe returnTo paths within the allowlist', async () => {
      const state = 'test-state-safe';
      const stateDataStr = JSON.stringify({
        provider: 'google',
        codeVerifier: 'xyz',
        returnTo: 'http://localhost:3000/home',
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

      prisma.identity.findUnique.mockResolvedValueOnce({
        userId: 'old-user-123',
        user: { id: 'old-user-123', email: 'old@example.com' },
      });

      mockGoogleOAuth();

      const res = await request(app)
        .get(`/auth/google/callback?code=test-code&state=${state}`)
        .set('Cookie', [`oauth_state=${state}`]);

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('http://localhost:3000/home');
    });

    it('rejects open redirects and malicious protocols, defaulting to safe redirect', async () => {
      const maliciousPaths = [
        'https://evil.com/phishing',
        'javascript:alert(1)', // XSS
        '//evil.com',
      ];

      for (const path of maliciousPaths) {
        vi.clearAllMocks();
        const state = 'test-state-malicious';
        const stateDataStr = JSON.stringify({
          provider: 'google',
          codeVerifier: 'xyz',
          returnTo: path,
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

        prisma.identity.findUnique.mockResolvedValueOnce({
          userId: 'old-user-123',
          user: { id: 'old-user-123', email: 'old@example.com' },
        });

        mockGoogleOAuth();

        const res = await request(app)
          .get(`/auth/google/callback?code=test-code&state=${state}`)
          .set('Cookie', [`oauth_state=${state}`]);

        expect(res.status).toBe(302);
        // Spec §11.1: MUST fall back to a safe default if invalid, not crash or execute
        expect(res.header.location).toBe('http://localhost:3000/');
      }
    });
  });

  describe('Rate Limiting (Spec §11.5)', () => {
    it('returns 429 Too Many Requests when rate limit is exceeded', async () => {
      // Clear mocks to ensure fresh state
      vi.clearAllMocks();

      // Force the rate limiter to exceed
      redisClient.multi().exec.mockImplementationOnce(() =>
        Promise.resolve([
          [null, 'OK'],
          [null, 'OK'],
          [null, 21], // Exceeds standard limit of 20
          [null, 'OK'],
        ]),
      );

      const res = await request(app).get('/auth/google');

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});
