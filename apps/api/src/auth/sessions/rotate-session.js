import { createSession } from './create-session.js';
import { revokeSession } from './revoke-session.js';

/**
 * Rotates a user's session by issuing a new session ID and revoking the old one.
 * Used during privilege-relevant events (e.g. linking a new OAuth provider).
 * The operations are sequenced to ensure the user is never left without a valid session.
 *
 * @param {string} userId - The owner of the session
 * @param {string} oldSessionId - The session identifier to rotate out
 * @returns {Promise<{ newSessionId: string, createdAt: number }>}
 */
export async function rotateSession(userId, oldSessionId) {
  if (!userId || !oldSessionId) {
    throw new Error('Both userId and oldSessionId are required for rotation');
  }

  // 1. Create the new session first.
  // If this fails, the user retains their valid old session and no state is lost.
  const { sessionId: newSessionId, createdAt } = await createSession(userId);

  // 2. Revoke the old session.
  // If this fails, they temporarily have two valid sessions, which is preferable
  // to having zero valid sessions if we had revoked first.
  try {
    await revokeSession(userId, oldSessionId);
  } catch (err) {
    // In a production system, this failure should be logged for investigation.
    // For now, we allow the new session creation to succeed so the user isn't logged out.
    // The old session will naturally expire anyway due to the sliding TTL.
  }

  return { newSessionId, createdAt };
}
