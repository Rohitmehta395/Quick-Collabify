import { z } from 'zod';

/**
 * Validates the query parameters returned by an OAuth provider during the callback phase.
 */
export const oauthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State parameter is required'),
  error: z.string().optional(),
});
