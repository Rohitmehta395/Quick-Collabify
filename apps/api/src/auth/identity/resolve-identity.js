import { prisma } from '../../db.js';

export const IdentityResultType = {
  RETURNING_USER: 'RETURNING_USER',
  CONFLICTING_IDENTITY: 'CONFLICTING_IDENTITY',
  LINKING_CANDIDATE: 'LINKING_CANDIDATE',
  NEW_USER: 'NEW_USER'
};

/**
 * Resolves the identity of a user based on their OAuth profile.
 * This is a pure read-only decision function based on Spec §3.
 * 
 * @param {string} provider - The OAuth provider (e.g., 'google', 'github')
 * @param {string} providerUserId - The unique ID from the provider
 * @param {string} email - The verified email from the provider
 * @param {string|null} [currentUserId=null] - The ID of the currently authenticated user, if applicable
 * 
 * @returns {Promise<{ type: string, user: object|null, identity: object|null }>}
 */
export async function resolveIdentity(provider, providerUserId, email, currentUserId = null) {
  // 1. Look for an existing Identity matching the provider and providerUserId exactly.
  // We NEVER look up by email to find an Identity.
  const existingIdentity = await prisma.identity.findUnique({
    where: {
      provider_providerUserId: {
        provider,
        providerUserId
      }
    },
    include: {
      user: true
    }
  });

  if (existingIdentity) {
    // If we're linking from an existing session, ensure the target Identity
    // isn't already claimed by a different user.
    if (currentUserId && existingIdentity.userId !== currentUserId) {
      return {
        type: IdentityResultType.CONFLICTING_IDENTITY,
        user: existingIdentity.user,
        identity: existingIdentity
      };
    }
    
    // Otherwise, this is a standard returning user sign-in.
    return {
      type: IdentityResultType.RETURNING_USER,
      user: existingIdentity.user,
      identity: existingIdentity
    };
  }

  // 2. No matching Identity exists. We check if the email matches any existing User.
  // Using findFirst because email is indexed but NOT uniquely constrained (Spec §9.2).
  const existingUserByEmail = await prisma.user.findFirst({
    where: { email },
    orderBy: { createdAt: 'asc' } // Grab the oldest (primary) account if multiple exist
  });

  if (existingUserByEmail) {
    // A user with this email exists, but they don't have an Identity for this provider yet.
    return {
      type: IdentityResultType.LINKING_CANDIDATE,
      user: existingUserByEmail,
      identity: null
    };
  }

  // 3. No Identity, and no matching User email. This is a brand new user.
  return {
    type: IdentityResultType.NEW_USER,
    user: null,
    identity: null
  };
}
