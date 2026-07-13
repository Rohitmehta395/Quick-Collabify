import { logger } from '@workspace/logger';
import { emailJobPayloadSchema } from '@workspace/schemas';
import {
  getNotificationEventByIdempotencyKey,
  updateNotificationEventStatus,
} from '../../../api/src/notifications/notification-event-repository.js';
import { prisma } from '../../../api/src/db.js';
import { sendWelcomeEmail } from '../email/send-welcome-email.js';

/**
 * Processes email jobs from BullMQ.
 *
 * P2-T13: Includes an idempotency check to avoid duplicate sends.
 * P2-T14: Fetches user details, sends the email, and records the outcome.
 */
export async function processEmailJob(job) {
  logger.info({ jobId: job.id }, 'Received email job');

  // Validate the payload. If validation fails, Zod throws an error which
  // BullMQ naturally catches and marks the job as failed.
  const payload = emailJobPayloadSchema.parse(job.data);

  // 1. Idempotency Check (P2-T13)
  const event = await getNotificationEventByIdempotencyKey(payload.idempotencyKey);

  if (event && event.status === 'sent') {
    logger.info(
      { jobId: job.id, idempotencyKey: payload.idempotencyKey },
      'Email already sent. Short-circuiting gracefully (Idempotency check).',
    );
    return { status: 'success', noop: true };
  }

  // 2. Fetch User Details (P2-T14)
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user) {
    throw new Error(`User not found for ID: ${payload.userId}`);
  }

  // 3. Execute Send and Record Outcome (P2-T14 & P2-T21)
  let providerResponse;
  try {
    providerResponse = await sendWelcomeEmail(user);
  } catch (err) {
    // If the provider send fails, we update the status to failed (best-effort) and rethrow
    // so BullMQ's normal retry mechanism kicks in.
    try {
      await updateNotificationEventStatus(payload.idempotencyKey, 'failed', {
        error: err.message,
      });
    } catch (writeErr) {
      logger.warn(
        { err: writeErr, originalError: err },
        'Failed to record failed status in DB after send failure',
      );
    }
    throw err;
  }

  // The email sent successfully. Now record the outcome with independent retries (P2-T21).
  let writeSuccess = false;
  let writeAttempts = 0;
  let lastWriteErr = null;
  const maxWriteAttempts = 3;

  while (!writeSuccess && writeAttempts < maxWriteAttempts) {
    try {
      writeAttempts++;
      await updateNotificationEventStatus(payload.idempotencyKey, 'sent', {
        messageId: providerResponse.MessageID,
      });
      writeSuccess = true;
    } catch (err) {
      lastWriteErr = err;
      if (writeAttempts < maxWriteAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  if (!writeSuccess) {
    logger.error(
      { jobId: job.id, idempotencyKey: payload.idempotencyKey, err: lastWriteErr },
      'Inconsistency alert: Welcome email was sent successfully but recording the outcome failed permanently in the DB.',
    );
    // Return normally to prevent BullMQ from retrying the job and sending a duplicate email
  } else {
    logger.info(
      {
        jobId: job.id,
        idempotencyKey: payload.idempotencyKey,
        messageId: providerResponse.MessageID,
      },
      'Welcome email sent and outcome recorded successfully.',
    );
  }

  return { status: 'success' };
}
