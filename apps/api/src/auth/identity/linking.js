import crypto from 'node:crypto';
import { redisClient } from '../sessions/redis-keys.js';
import { prisma } from '../../db.js';
import { createSession } from '../sessions/create-session.js';
import { rotateSession } from '../sessions/rotate-session.js';
import { OperationalError } from '@workspace/errors';

const LINKING_TTL = 15 * 60; // 15 minutes

/**
 * Creates a pending linking context in Redis and returns the token.
 * 
 * @param {object} profile - OAuth profile
 * @param {string} targetUserId - The existing user ID to link to
 * @returns {Promise<string>} The linking token
 */
export async function createPendingLink(profile, targetUserId) {
  const token = crypto.randomUUID();
  const key = `pending-link:${token}`;
  
  const payload = JSON.stringify({ profile, targetUserId });
  await redisClient.set(key, payload, 'EX', LINKING_TTL);
  
  return token;
}

/**
 * Processes a linking confirmation/decline request.
 * 
 * @param {string} token - The pending linking token
 * @param {string} action - 'confirm' | 'decline'
 * @param {string|null} currentSessionId - The user's active session, if any, to rotate
 * @returns {Promise<{ success: boolean, message: string, session?: object }>}
 */
export async function processLinkingConfirmation(token, action, currentSessionId = null) {
  if (!token) {
    throw new OperationalError('Missing linking token', 400, 'MISSING_LINKING_TOKEN');
  }

  const key = `pending-link:${token}`;
  const payloadString = await redisClient.get(key);

  if (!payloadString) {
    throw new OperationalError('Linking session expired or invalid', 401, 'INVALID_LINKING_TOKEN');
  }

  const { profile, targetUserId } = JSON.parse(payloadString);

  // Consume token immediately to prevent replay attacks
  await redisClient.del(key);

  if (action === 'decline') {
    // Explicitly create nothing, return safe rejection per Spec 3.3
    return {
      success: false,
      message: 'Account linking declined. Please sign in with your original provider.'
    };
  }

  if (action === 'confirm') {
    // 1. Create the new Identity for the existing user
    await prisma.identity.create({
      data: {
        userId: targetUserId,
        provider: profile.provider,
        providerUserId: profile.providerId
      }
    });

    // 2. Issue a session
    let sessionResult;
    if (currentSessionId) {
      sessionResult = await rotateSession(targetUserId, currentSessionId);
    } else {
      sessionResult = await createSession(targetUserId);
    }

    return {
      success: true,
      message: 'Account successfully linked.',
      session: sessionResult
    };
  }
  
  throw new OperationalError('Invalid action', 400, 'INVALID_ACTION');
}
