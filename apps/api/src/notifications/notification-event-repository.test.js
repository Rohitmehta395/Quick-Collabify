import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../db.js';
import { createNotificationEvent } from './notification-event-repository.js';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

describe('Database-Level Idempotency Constraint', () => {
  let userId;

  beforeAll(async () => {
    userId = crypto.randomUUID();
    // Pre-create user to satisfy foreign key constraint on recipientUserId
    await prisma.user.create({
      data: {
        id: userId,
        email: `test-${userId}@collabify.test`,
        displayName: 'Test User',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it('rejects duplicate inserts directly at the database level', async () => {
    const idempotencyKey = crypto.randomUUID();
    const type = 'test_event';

    // 1. Direct raw DB insert (first should succeed)
    const firstInsert = await prisma.notificationEvent.create({
      data: {
        idempotencyKey,
        recipientUserId: userId,
        type,
        status: 'pending',
      },
    });

    expect(firstInsert).toBeDefined();

    // 2. Direct raw DB insert again with the SAME idempotency key (should fail at DB level)
    let caughtError = null;
    try {
      await prisma.notificationEvent.create({
        data: {
          idempotencyKey,
          recipientUserId: userId,
          type,
          status: 'pending',
        },
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(caughtError.code).toBe('P2002'); // Unique constraint failed
  });
});
