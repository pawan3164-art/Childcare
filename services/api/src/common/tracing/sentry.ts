import * as Sentry from '@sentry/node';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // No Sentry account configured yet for local/dev — no-op, not an error.
    return;
  }
  Sentry.init({ dsn, tracesSampleRate: 1.0 });
}
