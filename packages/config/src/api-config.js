import { z } from 'zod';

/**
 * Zod schema defining the exact environment variables required by apps/api.
 */
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('3001'),
  DATABASE_URL: z.string().url({ message: 'Must be a valid Postgres connection URL' }),
  REDIS_URL: z.string().url({ message: 'Must be a valid Redis connection URL' }),

  // OAuth Providers
  OAUTH_GOOGLE_CLIENT_ID: z.string().min(1, 'Google Client ID is required'),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().min(1, 'Google Client Secret is required'),
  OAUTH_GOOGLE_REDIRECT_URI: z.string().url('Google Redirect URI must be a valid URL'),
  OAUTH_GITHUB_CLIENT_ID: z.string().min(1, 'GitHub Client ID is required'),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().min(1, 'GitHub Client Secret is required'),
  OAUTH_GITHUB_REDIRECT_URI: z.string().url('GitHub Redirect URI must be a valid URL'),

  // Queue Monitoring
  QUEUE_MONITOR_ENABLED: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .default('false'),
});
