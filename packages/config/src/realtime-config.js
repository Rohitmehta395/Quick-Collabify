import { z } from 'zod';

/**
 * Zod schema defining the exact environment variables required by apps/realtime.
 */
export const realtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('3002'),
  REDIS_URL: z.string().url({ message: 'Must be a valid Redis connection URL' }),
});
