import { z } from 'zod';

/**
 * Zod schema defining the exact environment variables required by apps/worker.
 */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url({ message: 'Must be a valid Postgres connection URL' }),
  REDIS_URL: z.string().url({ message: 'Must be a valid Redis connection URL' }),
});
