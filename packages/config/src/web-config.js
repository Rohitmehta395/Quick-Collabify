import { z } from 'zod';

/**
 * Zod schema defining the exact environment variables required by apps/web (frontend).
 * Notice that variables exposed to the browser must start with VITE_
 */
export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  VITE_API_URL: z.string().url({ message: 'Must be a valid URL for the API backend' }),
  VITE_REALTIME_URL: z
    .string()
    .url({ message: 'Must be a valid URL for the Realtime WebSockets server' }),
});
