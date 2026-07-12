import { redisClient, buildSessionKey, buildUserSessionsKey } from './redis-keys.js';

/**
 * Revokes a specific session atomically.
 * Deletes the session key and removes the ID from the user's active session set.
 * 
 * @param {string} userId - The owner of the session
 * @param {string} sessionId - The session identifier to revoke
 * @returns {Promise<void>}
 */
export async function revokeSession(userId, sessionId) {
  if (!userId || !sessionId) {
    throw new Error('Both userId and sessionId are required to revoke a session');
  }

  const sessionKey = buildSessionKey(sessionId);
  const userSessionsKey = buildUserSessionsKey(userId);

  // Atomically delete the session and remove it from the user's active set
  await redisClient.multi()
    .del(sessionKey)
    .srem(userSessionsKey, sessionId)
    .exec();
}
