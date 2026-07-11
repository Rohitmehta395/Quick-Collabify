import { Router } from 'express';
import { googleAuth, githubAuth } from './providers.js';
import { generateAndStoreState } from './state.js';
import { loadConfig, apiEnvSchema } from '@workspace/config';

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
