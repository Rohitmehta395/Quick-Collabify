import { loadConfig, apiEnvSchema } from '@workspace/config';
import { SESSION_IDLE_TTL } from './create-session.js';

export const SESSION_COOKIE_NAME = 'sessionId';

/**
 * Returns the strictly required security flags for the session cookie.
 */
function getCookieOptions() {
  const config = loadConfig(apiEnvSchema);
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * Sets the session cookie on the Express response.
 * 
 * @param {import('express').Response} res - The Express response object
 * @param {string} sessionId - The session identifier
 */
export function setSessionCookie(res, sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required to set cookie');
  }

  const options = {
    ...getCookieOptions(),
    maxAge: SESSION_IDLE_TTL * 1000, // Express expects maxAge in milliseconds
  };
  
  res.cookie(SESSION_COOKIE_NAME, sessionId, options);
}

/**
 * Clears the session cookie on the Express response.
 * 
 * @param {import('express').Response} res - The Express response object
 */
export function clearSessionCookie(res) {
  const options = getCookieOptions();
  
  // For clearing, Express requires the exact same domain/path/secure/sameSite flags
  res.clearCookie(SESSION_COOKIE_NAME, options);
}
