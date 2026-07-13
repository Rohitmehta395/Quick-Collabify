import { z } from 'zod';

/**
 * Zod schema defining the exact environment variables required by apps/worker.
 */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url({ message: 'Must be a valid Postgres connection URL' }),
  REDIS_URL: z.string().url({ message: 'Must be a valid Redis connection URL' }),

  // Email Provider
  POSTMARK_API_KEY: z.string().min(1, 'Postmark API Key is required'),
  EMAIL_FROM_ADDRESS: z.string().email('Must be a valid email address'),
});
