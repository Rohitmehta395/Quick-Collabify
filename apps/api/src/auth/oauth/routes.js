import { Router } from 'express';
import { googleAuth, githubAuth } from './providers.js';
import { generateAndStoreState, validateAndDeleteState } from './state.js';
import { exchangeGoogleCode, exchangeGithubCode } from './exchange.js';
import { loadConfig, apiEnvSchema } from '@workspace/config';
import { oauthCallbackSchema } from '@workspace/schemas';
import { OperationalError } from '@workspace/errors';

export const oauthRouter = Router();
const config = loadConfig(apiEnvSchema);

export const COOKIE_NAME = 'oauth_state';
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  maxAge: 10 * 60 * 1000, // 10 minutes (matching Redis TTL)
  path: '/',
};

oauthRouter.get('/google', async (req, res, next) => {
  try {
    const { state, codeVerifier } = await generateAndStoreState('google');
    const url = googleAuth.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);
    
    res.cookie(COOKIE_NAME, state, COOKIE_OPTIONS);
    res.redirect(url.href);
  } catch (err) {
    next(err);
  }
});

oauthRouter.get('/github', async (req, res, next) => {
  try {
    const { state } = await generateAndStoreState('github');
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
    
    // Spec §5.4: We discard tokens immediately after fetch.
    // For now, just return the fetched profile to prove success.
    res.json({ message: 'Google OAuth success! Identity extracted.', profile });
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
    
    res.json({ message: 'GitHub OAuth success! Identity extracted.', profile });
  } catch (err) {
    next(err);
  }
});
