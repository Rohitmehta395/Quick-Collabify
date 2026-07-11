import { Redis } from 'ioredis';
import { loadConfig, apiEnvSchema } from '@workspace/config';

// Load config to get validated REDIS_URL
const config = loadConfig(apiEnvSchema);

// Create and export the shared Redis client instance
export const redisClient = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

/**
 * Builds the Redis key for an individual user session.
 * Pattern: session:{sessionId}
 * @param {string} sessionId
 * @returns {string}
 */
export function buildSessionKey(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');
  return `session:${sessionId}`;
}

/**
 * Builds the Redis key for the Set containing all active session IDs for a user.
 * Pattern: user-sessions:{userId}
 * @param {string} userId
 * @returns {string}
 */
export function buildUserSessionsKey(userId) {
  if (!userId) throw new Error('userId is required');
  return `user-sessions:${userId}`;
}

/**
 * Builds the Redis key for storing OAuth state parameters during the auth flow.
 * Pattern: oauth-state:{state}
 * @param {string} state
 * @returns {string}
 */
export function buildOauthStateKey(state) {
  if (!state) throw new Error('state is required');
  return `oauth-state:${state}`;
}
