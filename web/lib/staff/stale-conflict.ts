/**
 * Whether a workflow error is the engine's own "somebody else changed this
 * application first" — the one case where the person should be told to
 * reload rather than shown the message.
 *
 * Every `status_conflict` used to be replaced with that line, which hid the
 * sentences actions write for the person at the screen: "Accept or reject
 * the documents first: birth certificate" came out as "This application
 * changed while you were looking at it", and staff reloaded, pressed again,
 * and read it again. Only `commit_transition()` raises the real conflict,
 * and its message starts with the code.
 */
export function isStaleConflict(e: { code: string; message: string }): boolean {
  return e.code === "status_conflict" && /^status_conflict\b/.test(e.message);
}

export const STALE_CONFLICT_MESSAGE = "This application changed while you were looking at it. Reload and try again.";
