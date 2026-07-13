import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processEmailJob } from './email-processor.js';
import * as repo from '../../../api/src/notifications/notification-event-repository.js';
import { prisma } from '../../../api/src/db.js';
import * as email from '../email/send-welcome-email.js';

vi.mock('../../../api/src/notifications/notification-event-repository.js', () => ({
  getNotificationEventByIdempotencyKey: vi.fn(),
  updateNotificationEventStatus: vi.fn(),
}));

vi.mock('../../../api/src/db.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('../email/send-welcome-email.js', () => ({
  sendWelcomeEmail: vi.fn(),
}));

describe('Email Processor Failure & Retry Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const job = {
    id: 'job-1',
    data: {
      userId: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
      idempotencyKey: 'test-key',
    },
  };

  it('throws an error if the email provider fails to trigger BullMQ retry', async () => {
    repo.getNotificationEventByIdempotencyKey.mockResolvedValue({ status: 'pending' });
    prisma.user.findUnique.mockResolvedValue({ id: '59263bc7-16e2-4b87-9bb9-42c579715fd7' });

    // Simulate Postmark failure
    const error = new Error('Postmark API unavailable');
    email.sendWelcomeEmail.mockRejectedValue(error);

    await expect(processEmailJob(job)).rejects.toThrow('Postmark API unavailable');

    // Should also attempt to mark status as failed
    expect(repo.updateNotificationEventStatus).toHaveBeenCalledWith(
      'test-key',
      'failed',
      expect.any(Object),
    );
  });

  it('returns success and does NOT throw if DB write fails after email is sent (prevents duplicate sends)', async () => {
    repo.getNotificationEventByIdempotencyKey.mockResolvedValue({ status: 'pending' });
    prisma.user.findUnique.mockResolvedValue({ id: '59263bc7-16e2-4b87-9bb9-42c579715fd7' });

    // Simulate Postmark success
    email.sendWelcomeEmail.mockResolvedValue({ MessageID: 'fake-message-id' });

    // Simulate persistent DB failure after retries
    repo.updateNotificationEventStatus.mockRejectedValue(new Error('DB Connection Refused'));

    // Should NOT throw! Returning success prevents BullMQ from retrying the job.
    const result = await processEmailJob(job);
    expect(result).toEqual({ status: 'success' });

    // Ensure it tried multiple times (retries)
    expect(repo.updateNotificationEventStatus).toHaveBeenCalledTimes(3);
  });
});
