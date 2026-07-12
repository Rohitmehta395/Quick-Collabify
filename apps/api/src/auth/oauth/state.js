import { generateState, generateCodeVerifier } from 'arctic';
import { redisClient, buildOauthStateKey } from '../sessions/redis-keys.js';

const STATE_TTL_SECONDS = 10 * 60; // 10 minutes

/**
 * Generates a new OAuth state parameter and PKCE code verifier,
 * and stores the verifier and provider in Redis with a TTL.
 * 
 * @param {string} provider The name of the OAuth provider (e.g., 'google', 'github')
 * @param {string} [returnTo] Optional URL to redirect back to after sign-in
 * @returns {Promise<{ state: string, codeVerifier: string }>}
 */
export async function generateAndStoreState(provider, returnTo = null) {
  if (!provider) throw new Error('Provider must be specified');

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  
  const key = buildOauthStateKey(state);
  
  // Store the code verifier, provider, and returnTo as a JSON string
  const payload = JSON.stringify({ codeVerifier, provider, returnTo });
  
  await redisClient.set(key, payload, 'EX', STATE_TTL_SECONDS);

  return { state, codeVerifier };
}

/**
 * Validates a given state by retrieving its stored data from Redis and immediately deleting it.
 * This ensures the state can only be used once (preventing replay attacks).
 * 
 * @param {string} state The state string to validate
 * @returns {Promise<{ codeVerifier: string, provider: string } | null>} Returns the stored data or null if invalid/expired.
 */
export async function validateAndDeleteState(state) {
  if (!state) return null;

  const key = buildOauthStateKey(state);
  
  // Atomically get and delete the key to prevent replay attacks
  const results = await redisClient.multi().get(key).del(key).exec();
  
  // The result of `get` is in results[0][1] (format: [error, result])
  const getResult = results[0][1];
  
  if (!getResult) {
    return null; // State not found or already consumed
  }

  try {
    const data = JSON.parse(getResult);
    return data;
  } catch (err) {
    // Malformed JSON data in Redis (should not happen, but defensive)
    return null;
  }
}
