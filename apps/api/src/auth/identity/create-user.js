import { prisma } from '../../db.js';
import { IdentityResultType } from './resolve-identity.js';

/**
 * Handles the creation paths for identities based on resolution.
 * For NEW_USER, transactionally creates a User and their initial Identity.
 * For RETURNING_USER, it returns the passed-through user object.
 * (Linking candidates and conflicts are handled elsewhere).
 * 
 * @param {object} resolution - The result from resolveIdentity()
 * @param {object} profile - The standardized profile from the OAuth provider
 * @param {string} profile.provider - Provider name (e.g., 'google')
 * @param {string} profile.providerId - Provider's unique user ID
 * @param {string} profile.email - Verified email
 * @param {string} [profile.displayName] - Optional name
 * @param {string} [profile.avatarUrl] - Optional avatar URL
 * 
 * @returns {Promise<object>} The resulting User object
 */
export async function executeIdentityCreation(resolution, profile) {
  if (resolution.type === IdentityResultType.RETURNING_USER) {
    // Returning users require no DB writes during sign-in
    return resolution.user;
  }

  if (resolution.type === IdentityResultType.NEW_USER) {
    // Prisma nested writes are automatically wrapped in a database transaction.
    // If the Identity fails to insert, the User insert is rolled back,
    // ensuring we never have an orphaned User with no identities.
    const newUser = await prisma.user.create({
      data: {
        email: profile.email,
        displayName: profile.displayName || null,
        avatarUrl: profile.avatarUrl || null,
        identities: {
          create: {
            provider: profile.provider,
            providerUserId: profile.providerId
          }
        }
      }
    });

    return newUser;
  }

  throw new Error(`executeIdentityCreation cannot handle resolution type: ${resolution.type}`);
}
