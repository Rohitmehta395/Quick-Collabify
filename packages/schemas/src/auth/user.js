import { z } from 'zod';

/**
 * Validates the shape of a User object, typically used when serializing
 * the current user out to the frontend client.
 */
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});
