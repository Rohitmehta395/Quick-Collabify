import pino from 'pino';

// Define keys that should be scrubbed from logs for security.
const REDACTED_KEYS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'accessToken',
  'refreshToken',
];

/**
 * Creates a structured JSON logger with automatic secret redaction.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    // Ensures the level is printed as a string ('info') rather than a number (30)
    level: (label) => {
      return { level: label };
    },
  },
  redact: {
    paths: REDACTED_KEYS,
    // What to replace the sensitive data with
    censor: '[REDACTED]',
  },
});
