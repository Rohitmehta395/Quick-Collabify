import { Router } from 'express';
import { googleAuth, githubAuth } from './providers.js';
import { generateAndStoreState, validateAndDeleteState } from './state.js';
import { exchangeGoogleCode, exchangeGithubCode } from './exchange.js';
import { loadConfig, apiEnvSchema } from '@workspace/config';
import { oauthCallbackSchema, linkingConfirmationSchema } from '@workspace/schemas';
import { OperationalError } from '@workspace/errors';
import { processLinkingConfirmation, createPendingLink } from '../identity/linking.js';
import { setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from '../sessions/cookie.js';
import { resolveIdentity, IdentityResultType } from '../identity/resolve-identity.js';
import { executeIdentityCreation } from '../identity/create-user.js';
import { createSession } from '../sessions/create-session.js';
import { revokeSession } from '../sessions/revoke-session.js';
import { validateRedirectUrl } from '../redirect-allowlist.js';
import { enqueueWelcomeEmail } from '../../jobs/enqueue-welcome-email.js';
import { authenticate } from '../middleware/authenticate.js';
import { oauthRateLimiter } from '../middleware/rate-limit.js';
import { prisma } from '../../db.js';
import { logger } from '@workspace/logger';

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

  const resolution = await resolveIdentity(
    profile.provider,
    profile.providerId,
    profile.email,
    currentUserId,
  );

  if (resolution.type === IdentityResultType.CONFLICTING_IDENTITY) {
    throw new OperationalError(
      'Identity already linked to a different user',
      409,
      'CONFLICTING_IDENTITY',
    );
  }

  if (resolution.type === IdentityResultType.LINKING_CANDIDATE) {
    logger.info({ provider: profile.provider }, 'Account-linking confirmation shown');
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

  if (resolution.type === IdentityResultType.NEW_USER) {
    try {
      await enqueueWelcomeEmail(user);
    } catch (err) {
      // Non-blocking: we catch and log, but do not throw, so the user login completes successfully
      logger.error({ userId: user.id, err }, 'Failed to enqueue welcome email (non-blocking)');
    }
  }

  logger.info(
    {
      userId: user.id,
      provider: profile.provider,
      type: resolution.type === IdentityResultType.NEW_USER ? 'new user' : 'returning user',
    },
    'Successful login',
  );

  const sessionResult = await createSession(user.id);
  setSessionCookie(res, sessionResult.sessionId);

  const safeRedirect = validateRedirectUrl(storedState.returnTo);
  res.redirect(safeRedirect);
}

// ==========================================
// INITIATION ROUTES (PUBLIC)
// ==========================================

oauthRouter.get('/google', oauthRateLimiter, async (req, res, next) => {
  try {
    const returnTo = req.query.returnTo;
    const { state, codeVerifier } = await generateAndStoreState('google', returnTo);
    const url = googleAuth.createAuthorizationURL(state, codeVerifier, [
      'openid',
      'profile',
      'email',
    ]);

    res.cookie(COOKIE_NAME, state, COOKIE_OPTIONS);
    res.redirect(url.href);
  } catch (err) {
    next(err);
  }
});

oauthRouter.get('/github', oauthRateLimiter, async (req, res, next) => {
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
// CALLBACK ROUTES (PUBLIC)
// ==========================================

oauthRouter.get('/google/callback', oauthRateLimiter, async (req, res, next) => {
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
    logger.warn(
      {
        reasonCategory: err.isOperational
          ? err.errorCode
          : err.name === 'ArcticFetchError'
            ? 'NETWORK_TIMEOUT'
            : 'UNKNOWN_ERROR',
        provider: 'google',
      },
      'Failed login',
    );
    next(err);
  }
});

oauthRouter.get('/github/callback', oauthRateLimiter, async (req, res, next) => {
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
    logger.warn(
      {
        reasonCategory: err.isOperational
          ? err.errorCode
          : err.name === 'ArcticFetchError'
            ? 'NETWORK_TIMEOUT'
            : 'UNKNOWN_ERROR',
        provider: 'github',
      },
      'Failed login',
    );
    next(err);
  }
});

// ==========================================
// ACCOUNT LINKING ROUTES (PROTECTED BY PENDING CONTEXT)
// ==========================================
// Note: This route is only reachable mid-flow with a valid pending_linking_token.
// It is protected, but NOT by the standard 'authenticate' session middleware,
// because the user does not yet have an active session.

oauthRouter.post('/linking/confirm', oauthRateLimiter, async (req, res, next) => {
  try {
    const { action } = linkingConfirmationSchema.parse(req.body);
    const linkingToken = req.cookies[LINKING_COOKIE_NAME];

    if (!linkingToken) {
      throw new OperationalError(
        'No pending link found or session expired',
        401,
        'NO_PENDING_LINK',
      );
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

// ==========================================
// AUTHENTICATED ROUTES (PROTECTED BY SESSION)
// ==========================================

oauthRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      // Very unlikely since session validates against a known userId, but possible if DB was wiped manually
      throw new OperationalError('User not found', 404, 'USER_NOT_FOUND');
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});

oauthRouter.post('/logout', authenticate, async (req, res, next) => {
  try {
    const sessionId = req.user.sessionId;

    // Revoke the session in Redis to prevent reuse
    await revokeSession(req.user.userId, sessionId);

    // Clear the cookie client-side
    clearSessionCookie(res);

    logger.info(
      {
        userId: req.user.userId,
        sessionRef: sessionId.slice(0, 8),
      },
      'Logout',
    );

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});
