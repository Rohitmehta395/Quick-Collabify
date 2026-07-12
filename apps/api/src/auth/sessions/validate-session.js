import { redisClient, buildSessionKey, buildUserSessionsKey } from './redis-keys.js';
import { SESSION_IDLE_TTL, SESSION_ABSOLUTE_TTL } from './create-session.js';

/**
 * Validates a session ID against Redis, enforcing both sliding and absolute expiration.
 *
 * @param {string} sessionId - The session identifier to validate
 * @returns {Promise<{ userId: string, createdAt: number } | null>} Returns session data if valid, null otherwise.
 */
export async function validateSession(sessionId) {
  if (!sessionId) return null;

  const sessionKey = buildSessionKey(sessionId);
  const dataString = await redisClient.get(sessionKey);

  if (!dataString) {
    return null; // Session does not exist or has naturally expired (idle TTL elapsed)
  }

  let data;
  try {
    data = JSON.parse(dataString);
  } catch (err) {
    return null; // Malformed data
  }

  const { userId, createdAt } = data;
  if (!userId || !createdAt) return null;

  // Enforce Absolute Cap
  const ageMs = Date.now() - createdAt;
  const maxAgeMs = SESSION_ABSOLUTE_TTL * 1000;

  if (ageMs >= maxAgeMs) {
    // Absolute TTL exceeded. Atomically revoke session to prevent zombie keys.
    const userSessionsKey = buildUserSessionsKey(userId);
    await redisClient.multi().del(sessionKey).srem(userSessionsKey, sessionId).exec();

    return null;
  }

  // Session is valid and within both bounds. Slide the idle expiration window.
  await redisClient.expire(sessionKey, SESSION_IDLE_TTL);

  return { userId, createdAt };
}
