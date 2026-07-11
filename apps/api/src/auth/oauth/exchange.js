import { googleAuth, githubAuth } from './providers.js';

export async function exchangeGoogleCode(code, codeVerifier) {
  const tokens = await googleAuth.validateAuthorizationCode(code, codeVerifier);
  
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`
    }
  });
  if (!response.ok) throw new Error("Failed to fetch Google user info");
  
  const user = await response.json();
  
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

  let email = user.email;
  if (!email) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokens.accessToken()}`
      }
    });
    if (emailsResponse.ok) {
      const emails = await emailsResponse.json();
      const primaryEmail = emails.find((e) => e.primary) || emails[0];
      email = primaryEmail?.email;
    }
  }

  return {
    providerId: String(user.id),
    email: email,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url
  };
}
