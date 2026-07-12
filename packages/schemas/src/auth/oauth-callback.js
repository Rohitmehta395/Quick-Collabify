import { z } from 'zod';

/**
 * Validates the query parameters returned by an OAuth provider during the callback phase.
 */
export const oauthCallbackSchema = z
  .object({
    code: z.string().optional(),
    state: z.string().min(1, 'State parameter is required'),
    error: z.string().optional(),
  })
  .refine((data) => data.code || data.error, {
    message: 'Either authorization code or error must be provided',
  });
