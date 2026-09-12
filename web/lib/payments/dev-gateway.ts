import { devShortcutsAllowed } from "@/lib/deployment";

/**
 * The development gateway page and its simulate action.
 *
 * This used to read `VERCEL_ENV !== "production"`, which is true on every
 * preview deployment — where `PAYMENT_PROVIDER` is unset and therefore
 * defaults to `dev`. A preview build is reachable by URL and points at
 * whatever database its environment names, so the screen whose only power is
 * writing "this payment succeeded" was live outside production against
 * production data. See `lib/deployment.ts`.
 */
export function devGatewayEnabled(): boolean {
  return devShortcutsAllowed() && (process.env.PAYMENT_PROVIDER ?? "dev") === "dev";
}
