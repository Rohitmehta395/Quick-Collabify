import { prisma } from '../db.js';
import { Prisma } from '@prisma/client';
import { logger } from '@workspace/logger';

/**
 * Creates a new notification event record with a default 'pending' status.
 * Intentionally allows unique constraint violations on `idempotencyKey` to bubble up,
 * so they can be explicitly handled by the caller.
 *
 * @param {Object} params
 * @param {string} params.idempotencyKey - The unique deterministic key for this event
 * @param {string} params.userId - The ID of the recipient user
 * @param {string} params.type - The type of the event (e.g. 'welcome-email')
 * @param {Object} [params.metadata] - Optional arbitrary metadata
 * @returns {Promise<Object>} The created NotificationEvent record
 */

export async function createNotificationEvent({ idempotencyKey, userId, type, metadata }) {
  try {
    return await prisma.notificationEvent.create({
      data: {
        idempotencyKey,
        recipientUserId: userId,
        type,
        status: 'pending',
        metadata: metadata || {},
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(
        { idempotencyKey, userId, type },
        'Concurrent enqueue detected: unique constraint violation on idempotency key gracefully handled',
      );
      // Return null or the existing record to signify safe no-op.
      // The caller (enqueue function) will proceed as if everything is fine, preventing the application from crashing.
      return null;
    }
    throw err;
  }
}

/**
 * Retrieves an existing notification event by its unique idempotency key.
 *
 * @param {string} idempotencyKey - The key to search for
 * @returns {Promise<Object|null>} The NotificationEvent record, or null if not found
 */
export async function getNotificationEventByIdempotencyKey(idempotencyKey) {
  return prisma.notificationEvent.findUnique({
    where: { idempotencyKey },
  });
}

/**
 * Updates the status and optional provider response of an existing notification event.
 *
 * @param {string} idempotencyKey - The key of the event to update
 * @param {string} status - The new status ('sent', 'failed')
 * @param {Object} [providerResponse] - Optional raw response data from the provider
 * @returns {Promise<Object>} The updated NotificationEvent record
 */
export async function updateNotificationEventStatus(idempotencyKey, status, metadata) {
  return prisma.notificationEvent.update({
    where: { idempotencyKey },
    data: {
      status,
      metadata: metadata || {},
    },
  });
}
