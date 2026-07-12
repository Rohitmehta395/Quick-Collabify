/**
 * Validates a given returnTo URL against an allowlist to prevent Open Redirect vulnerabilities.
 * Spec §11.1 requires all post-login redirect targets to be explicitly validated.
 * 
 * @param {string} url - The untrusted redirect target requested by the client
 * @returns {string} A safe, validated URL to redirect to
 */
export function validateRedirectUrl(url) {
  // In a real production deployment, this would come from api-config.js.
  // For Phase 1 local development, we hardcode the expected frontend origin.
  const ALLOWED_ORIGINS = [
    'http://localhost:3000'
  ];
  const defaultRedirect = 'http://localhost:3000/';

  if (!url) {
    return defaultRedirect;
  }

  try {
    const parsed = new URL(url);
    if (ALLOWED_ORIGINS.includes(parsed.origin)) {
      return parsed.href;
    }
  } catch (err) {
    // Malformed or relative URL that fails parsing; fallback to default
  }

  return defaultRedirect;
}
