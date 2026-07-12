import { googleAuth, githubAuth } from './providers.js';
import { OperationalError } from '@workspace/errors';
import { OAuth2RequestError } from 'arctic';
import { logger } from '@workspace/logger';

export async function exchangeGoogleCode(code, codeVerifier) {
  let tokens;
  try {
    tokens = await googleAuth.validateAuthorizationCode(code, codeVerifier);
  } catch (err) {
    if (err instanceof OAuth2RequestError) {
      logger.warn(
        { provider: 'google', failureCategory: 'PROVIDER_ERROR' },
        'Provider failure detected',
      );
      throw new OperationalError(
        'Invalid authorization code or PKCE verifier',
        400,
        'PROVIDER_ERROR',
      );
    }
    if (err.name === 'ArcticFetchError') {
      logger.error(
        { provider: 'google', failureCategory: 'NETWORK_TIMEOUT' },
        'Provider outage detected',
      );
    }
    throw err;
  }

  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`,
    },
  });
  if (!response.ok) {
    logger.error(
      { provider: 'google', failureCategory: 'USERINFO_FETCH_FAILED' },
      'Provider outage detected',
    );
    throw new Error('Failed to fetch Google user info');
  }

  const user = await response.json();

  if (!user.email || !user.email_verified) {
    throw new OperationalError(
      'Please verify your email with Google and try again.',
      400,
      'UNVERIFIED_EMAIL',
    );
  }

  return {
    providerId: user.sub,
    email: user.email,
    displayName: user.name || user.given_name,
    avatarUrl: user.picture,
  };
}

export async function exchangeGithubCode(code) {
  let tokens;
  try {
    tokens = await githubAuth.validateAuthorizationCode(code);
  } catch (err) {
    if (err instanceof OAuth2RequestError) {
      logger.warn(
        { provider: 'github', failureCategory: 'PROVIDER_ERROR' },
        'Provider failure detected',
      );
      throw new OperationalError('Invalid authorization code', 400, 'PROVIDER_ERROR');
    }
    if (err.name === 'ArcticFetchError') {
      logger.error(
        { provider: 'github', failureCategory: 'NETWORK_TIMEOUT' },
        'Provider outage detected',
      );
    }
    throw err;
  }

  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`,
    },
  });
  if (!response.ok) {
    logger.error(
      { provider: 'github', failureCategory: 'USERINFO_FETCH_FAILED' },
      'Provider outage detected',
    );
    throw new Error('Failed to fetch GitHub user info');
  }
  const user = await response.json();

  const emailsResponse = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`,
    },
  });
  if (!emailsResponse.ok) {
    logger.error(
      { provider: 'github', failureCategory: 'USERINFO_FETCH_FAILED' },
      'Provider outage detected',
    );
    throw new Error('Failed to fetch GitHub user emails');
  }
  const emails = await emailsResponse.json();

  const primaryEmailObj = Array.isArray(emails) ? emails.find((e) => e.primary) : null;

  if (!primaryEmailObj || !primaryEmailObj.verified) {
    throw new OperationalError(
      'Please verify your email with GitHub and try again.',
      400,
      'UNVERIFIED_EMAIL',
    );
  }

  return {
    providerId: String(user.id),
    email: primaryEmailObj.email,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url,
  };
}
