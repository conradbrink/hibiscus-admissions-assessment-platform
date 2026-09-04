// Server-side error monitoring.
//
// `register` runs once as the server starts; `onRequestError` is Next's hook
// for errors thrown while rendering or in a route handler — a failed token
// exchange, a job drain that threw, a webhook that could not be verified.

import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/monitoring";

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.init(sharedSentryOptions);
}

export const onRequestError = Sentry.captureRequestError;
