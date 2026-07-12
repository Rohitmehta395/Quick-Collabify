import crypto from 'node:crypto';
import { redisClient, buildSessionKey, buildUserSessionsKey } from './redis-keys.js';
import { logger } from '@workspace/logger';

// 7 days idle TTL (refreshed on use)
export const SESSION_IDLE_TTL = 7 * 24 * 60 * 60;
// 30 days absolute max TTL
export const SESSION_ABSOLUTE_TTL = 30 * 24 * 60 * 60;

/**
 * Creates a new session for a user and stores it atomically in Redis.
 *
 * @param {string} userId - The unique identifier of the user
 * @returns {Promise<{ sessionId: string, createdAt: number }>}
 */
export async function createSession(userId) {
  if (!userId) {
    throw new Error('userId is required to create a session');
  }

  // 1. Generate a cryptographically random session ID
  const sessionId = crypto.randomUUID();

  // 2. Prepare keys
  const sessionKey = buildSessionKey(sessionId);
  const userSessionsKey = buildUserSessionsKey(userId);

  // 3. Prepare payload
  const createdAt = Date.now();
  const payload = JSON.stringify({
    userId,
    createdAt,
  });

  // 4. Atomically write the session data and add it to the user's session set
  // This prevents drift where a session exists but the user's set doesn't know about it.
  await redisClient
    .multi()
    // Set the session string with the initial idle TTL
    .set(sessionKey, payload, 'EX', SESSION_IDLE_TTL)
    // Add the session ID to the user's set of active sessions
    .sadd(userSessionsKey, sessionId)
    // Give the set an expiration as a fallback to prevent infinite growth of dead sets
    .expire(userSessionsKey, SESSION_ABSOLUTE_TTL)
    .exec();

  logger.info(
    {
      userId,
      sessionRef: sessionId.slice(0, 8),
    },
    'Session creation',
  );

  return { sessionId, createdAt };
}
