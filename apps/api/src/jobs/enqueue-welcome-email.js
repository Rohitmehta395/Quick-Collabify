import { emailQueue } from './email-queue.js';
import { deriveIdempotencyKey } from './idempotency-key.js';
import { createNotificationEvent } from '../notifications/notification-event-repository.js';
import { emailJobPayloadSchema } from '@workspace/schemas';
import { logger } from '@workspace/logger';

/**
 * Enqueues a welcome email job for a newly registered user.
 *
 * @param {Object} user
 * @param {string} user.id
 */
export async function enqueueWelcomeEmail(user) {
  const eventType = 'welcome_email';
  const idempotencyKey = deriveIdempotencyKey(user.id, eventType);

  // Validate the minimal payload we're going to put into the queue
  const payload = emailJobPayloadSchema.parse({
    userId: user.id,
    idempotencyKey,
  });

  // 1. Create the pending NotificationEvent record as our backstop
  await createNotificationEvent({
    type: eventType,
    userId: user.id,
    idempotencyKey,
  });

  // 2. Enqueue the actual job into Redis via BullMQ
  const job = await emailQueue.add(eventType, payload, {
    jobId: idempotencyKey, // Use idempotencyKey natively in BullMQ to prevent dupes in queue
  });

  logger.info(
    { userId: user.id, jobId: job.id, idempotencyKey },
    'Successfully enqueued welcome_email job',
  );

  return job;
}
