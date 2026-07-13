import { z } from 'zod';

/**
 * Zod schema defining the expected payload for the welcome email job.
 * Enforces the minimal-reference principle (Spec A 5.8 / A 10.4):
 * - only `userId` and `idempotencyKey` are passed.
 * - Profile data is fetched by the worker at execution time to ensure freshness.
 */
export const emailJobPayloadSchema = z.object({
  userId: z.string().uuid('Must be a valid UUID for the user ID'),
  idempotencyKey: z.string().min(1, 'Idempotency key is required'),
});
