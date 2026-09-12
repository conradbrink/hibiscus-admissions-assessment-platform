/**
 * Where this code is running, and whether the shortcuts a developer needs are
 * allowed to run here.
 *
 * Several controls used to be written as `VERCEL_ENV !== "production"`, which
 * reads as "not the real thing" and means "anything that is not the production
 * deployment" — including **preview deployments**, which are built from every
 * pull request, are reachable by URL unless deployment protection is on, and
 * are configured from the same environment variables as production unless
 * somebody has deliberately separated them.
 *
 * The sharpest example: the development payment gateway. Its whole purpose is
 * to write "this payment succeeded" onto a payment row without money moving.
 * `PAYMENT_PROVIDER` is set for the production environment only, so on a
 * preview build it is unset, defaults to `dev`, and the simulate screen is
 * live — against whatever database that deployment points at.
 *
 * So the question is no longer "is this production?" but "is this a
 * deployment at all?". A developer's own machine has no `VERCEL_ENV`; every
 * Vercel build has one. On a deployment the shortcuts are refused unless
 * somebody has said otherwise in as many words, and on production they are
 * refused outright — no variable turns them back on there.
 */

/** True only on a machine that is not a Vercel deployment. */
export function isLocalDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.VERCEL_ENV;
}

/**
 * Whether the development shortcuts may run: the simulated payment gateway,
 * the outbox's "pretend a parent replied", the kiosk walk-through without a
 * sitting, and narration without a kiosk session.
 *
 * Production: never, whatever the variables say.
 * Any other deployment: only with ALLOW_DEV_SHORTCUTS=1.
 * A developer's own machine: yes.
 */
export function devShortcutsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  if (env.VERCEL_ENV) return env.ALLOW_DEV_SHORTCUTS === "1";
  return true;
}
