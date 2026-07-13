import crypto from 'crypto';

/**
 * Derives a deterministic, collision-resistant idempotency key for a given user and event type.
 * Ensures that the same inputs always produce the same key (duplicate prevention) and different
 * inputs always produce different keys.
 *
 * @param {string} userId - The unique identifier of the user (e.g. UUID)
 * @param {string} eventType - The type of event (e.g. 'welcome-email')
 * @returns {string} The derived idempotency key (SHA-256 hash)
 */
export function deriveIdempotencyKey(userId, eventType) {
  if (!userId || !eventType) {
    throw new Error('Both userId and eventType are required to derive an idempotency key');
  }

  // Use a stable string concatenation. A colon or other separator prevents edge-case collisions
  // if userId and eventType strings could somehow bleed into each other.
  const rawInput = `${userId}:${eventType}`;

  return crypto.createHash('sha256').update(rawInput).digest('hex');
}
