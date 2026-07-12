import { Google, GitHub } from 'arctic';
import { loadConfig, apiEnvSchema } from '@workspace/config';

const config = loadConfig(apiEnvSchema);

export const googleAuth = new Google(
  config.OAUTH_GOOGLE_CLIENT_ID,
  config.OAUTH_GOOGLE_CLIENT_SECRET,
  config.OAUTH_GOOGLE_REDIRECT_URI,
);

export const githubAuth = new GitHub(
  config.OAUTH_GITHUB_CLIENT_ID,
  config.OAUTH_GITHUB_CLIENT_SECRET,
  config.OAUTH_GITHUB_REDIRECT_URI,
);
