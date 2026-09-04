// Browser-side error monitoring.
//
// Does nothing when NEXT_PUBLIC_SENTRY_DSN is unset — which is the case on a
// developer machine unless it is deliberately configured.

import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/monitoring";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init(sharedSentryOptions);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
