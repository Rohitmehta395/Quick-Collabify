import { Router } from 'express';
import { googleAuth, githubAuth } from './providers.js';
import { generateAndStoreState, validateAndDeleteState } from './state.js';
import { exchangeGoogleCode, exchangeGithubCode } from './exchange.js';
import { loadConfig, apiEnvSchema } from '@workspace/config';
import { oauthCallbackSchema, linkingConfirmationSchema } from '@workspace/schemas';
import { OperationalError } from '@workspace/errors';
import { processLinkingConfirmation, createPendingLink } from '../identity/linking.js';
import { setSessionCookie, SESSION_COOKIE_NAME } from '../sessions/cookie.js';
import { resolveIdentity, IdentityResultType } from '../identity/resolve-identity.js';
import { executeIdentityCreation } from '../identity/create-user.js';
import { createSession } from '../sessions/create-session.js';
import { validateRedirectUrl } from '../redirect-allowlist.js';

export const oauthRouter = Router();
const config = loadConfig(apiEnvSchema);

export const COOKIE_NAME = 'oauth_state';
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  maxAge: 10 * 60 * 1000, // 10 minutes (matching Redis TTL)
  path: '/',
};

export const LINKING_COOKIE_NAME = 'pending_linking_token';

// ==========================================
// SHARED SUCCESS HANDLER
// ==========================================

async function handleOAuthSuccess(req, res, profile, storedState) {
  // If we had middleware populating req.user, we'd pass req.user.id here.
  // For now, since callback isn't protected, we pass null.
  const currentUserId = null; 
  
  const resolution = await resolveIdentity(profile.provider, profile.providerId, profile.email, currentUserId);

  if (resolution.type === IdentityResultType.CONFLICTING_IDENTITY) {
    throw new OperationalError('Identity already linked to a different user', 409, 'CONFLICTING_IDENTITY');
  }

  if (resolution.type === IdentityResultType.LINKING_CANDIDATE) {
    const token = await createPendingLink(profile, resolution.user.id);
    const linkingOptions = { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 };
    res.cookie(LINKING_COOKIE_NAME, token, linkingOptions);
    
    // Redirect to frontend linking page with the returnTo preserved
    const safeRedirect = validateRedirectUrl(storedState.returnTo);
    const linkingUrl = new URL('/auth/link', 'http://localhost:3000');
    linkingUrl.searchParams.set('returnTo', safeRedirect);
    return res.redirect(linkingUrl.href);
  }

  // NEW_USER or RETURNING_USER
  const user = await executeIdentityCreation(resolution, profile);
  const sessionResult = await createSession(user.id);
  setSessionCookie(res, sessionResult.sessionId);
  
  const safeRedirect = validateRedirectUrl(storedState.returnTo);
  res.redirect(safeRedirect);
}

// ==========================================
// INITIATION ROUTES
// ==========================================

oauthRouter.get('/google', async (req, res, next) => {
  try {
    const returnTo = req.query.returnTo;
    const { state, codeVerifier } = await generateAndStoreState('google', returnTo);
    const url = googleAuth.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);
    
    res.cookie(COOKIE_NAME, state, COOKIE_OPTIONS);
    res.redirect(url.href);
  } catch (err) {
    next(err);
  }
});

oauthRouter.get('/github', async (req, res, next) => {
  try {
    const returnTo = req.query.returnTo;
    const { state } = await generateAndStoreState('github', returnTo);
    // GitHub does not use PKCE in the Arctic implementation
    const url = githubAuth.createAuthorizationURL(state, ['user:email']);
    
    res.cookie(COOKIE_NAME, state, COOKIE_OPTIONS);
    res.redirect(url.href);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// CALLBACK ROUTES
// ==========================================

oauthRouter.get('/google/callback', async (req, res, next) => {
  try {
    const { code, state, error } = oauthCallbackSchema.parse(req.query);
    if (error) {
      throw new OperationalError(`OAuth Provider Error: ${error}`, 400, 'OAUTH_ERROR');
    }
    
    const cookieState = req.cookies[COOKIE_NAME];
    if (!cookieState || state !== cookieState) {
      throw new OperationalError('Invalid or missing state parameter', 400, 'INVALID_STATE');
    }

    const storedState = await validateAndDeleteState(state);
    if (!storedState || storedState.provider !== 'google') {
      throw new OperationalError('State validation failed or expired', 400, 'INVALID_STATE');
    }

    const profile = await exchangeGoogleCode(code, storedState.codeVerifier);
    
    await handleOAuthSuccess(req, res, profile, storedState);
  } catch (err) {
    next(err);
  }
});

oauthRouter.get('/github/callback', async (req, res, next) => {
  try {
    const { code, state, error } = oauthCallbackSchema.parse(req.query);
    if (error) {
      throw new OperationalError(`OAuth Provider Error: ${error}`, 400, 'OAUTH_ERROR');
    }
    
    const cookieState = req.cookies[COOKIE_NAME];
    if (!cookieState || state !== cookieState) {
      throw new OperationalError('Invalid or missing state parameter', 400, 'INVALID_STATE');
    }

    const storedState = await validateAndDeleteState(state);
    if (!storedState || storedState.provider !== 'github') {
      throw new OperationalError('State validation failed or expired', 400, 'INVALID_STATE');
    }

    const profile = await exchangeGithubCode(code);
    
    await handleOAuthSuccess(req, res, profile, storedState);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// ACCOUNT LINKING ROUTES
// ==========================================

oauthRouter.post('/linking/confirm', async (req, res, next) => {
  try {
    const { action } = linkingConfirmationSchema.parse(req.body);
    const linkingToken = req.cookies[LINKING_COOKIE_NAME];
    
    if (!linkingToken) {
      throw new OperationalError('No pending link found or session expired', 401, 'NO_PENDING_LINK');
    }
    
    // Attempt to rotate if they already have an active session cookie
    const currentSessionId = req.cookies[SESSION_COOKIE_NAME] || null;
    
    const result = await processLinkingConfirmation(linkingToken, action, currentSessionId);
    
    // Clear the pending link token
    res.clearCookie(LINKING_COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 });
    
    if (result.success && result.session) {
      const newId = result.session.newSessionId || result.session.sessionId;
      setSessionCookie(res, newId);
    }
    
    res.json({ message: result.message, success: result.success });
  } catch (err) {
    next(err);
  }
});
