/**
 * @workspace/schemas
 *
 * Central registry for all Domain Zod Schemas.
 * (e.g., User Schema, Document Schema, Cursor Schema).
 *
 * We will export them here as named exports when they are implemented in future phases.
 */

export { oauthCallbackSchema } from './auth/oauth-callback.js';
export { linkingConfirmationSchema } from './auth/linking-confirmation.js';
export { userSchema } from './auth/user.js';
