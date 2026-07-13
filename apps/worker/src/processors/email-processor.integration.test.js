import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { processEmailJob } from './email-processor.js';
import { prisma } from '../../../api/src/db.js';
import { createNotificationEvent } from '../../../api/src/notifications/notification-event-repository.js';
import crypto from 'node:crypto';

describe('Email Processor Integration Tests', () => {
  beforeEach(async () => {
    // Clean up before test
    await prisma.notificationEvent.deleteMany({});
    await prisma.user.deleteMany({});
    nock.cleanAll();
  });

  afterEach(async () => {
    // Clean up after test
    await prisma.notificationEvent.deleteMany({});
    await prisma.user.deleteMany({});
    nock.cleanAll();
  });

  it('successfully processes a job and updates the DB (mocked provider)', async () => {
    // 1. Setup Data
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'integration-test@example.com',
        displayName: 'Integration Test User',
      },
    });

    const idempotencyKey = `welcome_email:${user.id}:test`;

    await createNotificationEvent({
      type: 'welcome_email',
      userId: user.id,
      idempotencyKey,
    });

    // 2. Mock Postmark
    const scope = nock('https://api.postmarkapp.com').post('/email').reply(200, {
      To: 'integration-test@example.com',
      SubmittedAt: new Date().toISOString(),
      MessageID: 'fake-message-id-12345',
      ErrorCode: 0,
      Message: 'OK',
    });

    // 3. Process the Job
    const job = {
      id: 'job-1',
      data: {
        userId: user.id,
        idempotencyKey,
      },
    };

    const result = await processEmailJob(job);

    // 4. Assertions
    expect(result).toEqual({ status: 'success' });
    expect(scope.isDone()).toBe(true); // Verifies Postmark was called

    const event = await prisma.notificationEvent.findUnique({
      where: { idempotencyKey },
    });

    expect(event).not.toBeNull();
    expect(event.status).toBe('sent');
    expect(event.metadata).toHaveProperty('messageId', 'fake-message-id-12345');
  });
});
