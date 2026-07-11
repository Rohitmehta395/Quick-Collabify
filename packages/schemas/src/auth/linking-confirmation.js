import { z } from 'zod';

/**
 * Validates the request body for an account-linking confirmation action.
 */
export const linkingConfirmationSchema = z.object({
  action: z.enum(['confirm', 'decline'], {
    required_error: 'Action must be explicitly confirm or decline',
  }),
});
