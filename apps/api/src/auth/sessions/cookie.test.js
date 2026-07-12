import { describe, it, expect, vi } from 'vitest';
import { setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from './cookie.js';
import { SESSION_IDLE_TTL } from './create-session.js';
import * as configMod from '@workspace/config';

// Mock config to ensure predictable test environment
vi.mock('@workspace/config', () => {
  return {
    loadConfig: vi.fn(() => ({
      NODE_ENV: 'production', // Tests secure flag behavior
    })),
    apiEnvSchema: {},
  };
});

describe('cookie.js', () => {
  describe('setSessionCookie', () => {
    it('sets the cookie with the correct security flags and maxAge', () => {
      const mockRes = {
        cookie: vi.fn(),
      };
      
      setSessionCookie(mockRes, 'test-session-id');
      
      expect(mockRes.cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        'test-session-id',
        expect.objectContaining({
          httpOnly: true,
          secure: true, // because we mocked NODE_ENV = 'production'
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_IDLE_TTL * 1000,
        })
      );
    });

    it('throws if no sessionId is provided', () => {
      const mockRes = { cookie: vi.fn() };
      expect(() => setSessionCookie(mockRes, null)).toThrow('sessionId is required');
    });
  });

  describe('clearSessionCookie', () => {
    it('clears the cookie with matching security flags', () => {
      const mockRes = {
        clearCookie: vi.fn(),
      };
      
      clearSessionCookie(mockRes);
      
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
        })
      );
    });
  });
});
