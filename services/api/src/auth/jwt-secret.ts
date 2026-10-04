const DEV_FALLBACK = 'dev-only-change-me';
const MIN_LENGTH = 32;

/**
 * BRD §18 secrets handling: in production the JWT signing secret must be set,
 * long enough to resist brute force, and never a value published in this repo
 * (.env.example). Anything else fails the process at startup rather than
 * silently signing tokens with a publicly known key.
 */
export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV !== 'production') return secret || DEV_FALLBACK;

  if (!secret) throw new Error('JWT_SECRET must be set in production');
  if (secret === DEV_FALLBACK) throw new Error('JWT_SECRET is the published dev placeholder');
  if (secret.length < MIN_LENGTH) throw new Error(`JWT_SECRET must be at least ${MIN_LENGTH} characters`);
  return secret;
}
