/**
 * An error whose message was written for the person at the screen: "This
 * vacancy has closed", "Add at least two referees". Actions throw these and
 * the form shows the message as it is. `code` is for the code.
 */
export class HrError extends Error {
  constructor(message: string, public readonly code: string = "hr_error") {
    super(message);
    this.name = "HrError";
  }
}

/** The database's own compare-and-set refusal: somebody else moved it first. */
export const STALE_MESSAGE = "This application changed while you were looking at it. Reload and try again.";
