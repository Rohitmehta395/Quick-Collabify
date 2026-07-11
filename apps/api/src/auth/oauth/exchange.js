import { googleAuth, githubAuth } from './providers.js';
import { OperationalError } from '@workspace/errors';

export async function exchangeGoogleCode(code, codeVerifier) {
  const tokens = await googleAuth.validateAuthorizationCode(code, codeVerifier);
  
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`
    }
  });
  if (!response.ok) throw new Error("Failed to fetch Google user info");
  
  const user = await response.json();
  
  if (!user.email || !user.email_verified) {
    throw new OperationalError(
      'Please verify your email with Google and try again.',
      400,
      'UNVERIFIED_EMAIL'
    );
  }
  
  return {
    providerId: user.sub,
    email: user.email,
    displayName: user.name || user.given_name,
    avatarUrl: user.picture
  };
}

export async function exchangeGithubCode(code) {
  const tokens = await githubAuth.validateAuthorizationCode(code);
  
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`
    }
  });
  if (!response.ok) throw new Error("Failed to fetch GitHub user info");
  const user = await response.json();

  const emailsResponse = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`
    }
  });
  if (!emailsResponse.ok) throw new Error("Failed to fetch GitHub user emails");
  const emails = await emailsResponse.json();
  
  const primaryEmailObj = Array.isArray(emails) ? emails.find((e) => e.primary) : null;
  
  if (!primaryEmailObj || !primaryEmailObj.verified) {
    throw new OperationalError(
      'Please verify your email with GitHub and try again.',
      400,
      'UNVERIFIED_EMAIL'
    );
  }

  return {
    providerId: String(user.id),
    email: primaryEmailObj.email,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url
  };
}
