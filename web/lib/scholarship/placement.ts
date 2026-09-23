/**
 * Which campus each class in a scholarship file belongs to.
 *
 * The spreadsheet does not say. "Form 1" is Block 7 and a primary stage is
 * Broadhurst, but Stages 4 to 7 are taught at *both* Block 7 and Broadhurst,
 * so no amount of reading the file — or the database — settles it. It is a
 * decision the person running the import makes, and it used to be a constant
 * compiled into the runner: changing where 25 children were placed meant
 * editing TypeScript and redeploying nothing, because the runner is run by
 * hand.
 *
 * So it is supplied per run, and this module is where the supplying is
 * decided, because the runner beside it only reads the environment and prints.
 * Pure, and tested: a placement that silently resolves to the wrong campus
 * puts a child at the wrong school, and one that silently resolves to nothing
 * refuses their row with a message about grades that explains nothing.
 */

export type Placement = { className: string; campusName: string };

/**
 * The placement for a run, from the strongest source that names each class.
 *
 * Three sources, in order: the per-class map wins, then the one-campus
 * setting, then whatever the runner was built with. Each class is decided on
 * its own, so a file that is mostly one campus needs `campus` plus a line of
 * `json` for the exceptions rather than a full map.
 *
 * A class no source names is left out rather than guessed. It then has no
 * grade to resolve to, the import refuses every row in it, and the runner's
 * own check stops the run before the commit flag is honoured — which is the
 * right end for "nobody said where these children go".
 */
export function resolvePlacement(opts: {
  /** The classes actually present in the file. Nothing else is worth placing. */
  classNames: string[];
  /** One campus for every class in the file. */
  campus?: string | null;
  /** JSON, class name to campus name. */
  json?: string | null;
  /**
   * The variable `json` came from, for the message when it is malformed. The
   * two runners read differently named variables and a complaint that named
   * the wrong one would send somebody to edit a variable they had not set.
   */
  variable?: string;
  /** What the runner falls back to when the environment says nothing. */
  fallback: Placement[];
}): Placement[] {
  const overrides = opts.json ? parsePlacement(opts.json, opts.variable ?? "the placement map") : [];
  const byClass = new Map(overrides.map((p) => [p.className, p.campusName]));
  const fallbackBy = new Map(opts.fallback.map((p) => [p.className, p.campusName]));
  const campus = opts.campus?.trim() || null;

  const out: Placement[] = [];
  for (const className of [...new Set(opts.classNames)]) {
    const campusName = byClass.get(className) ?? campus ?? fallbackBy.get(className);
    if (campusName) out.push({ className, campusName });
  }
  return out;
}

/**
 * `{"Form 1":"Block 7"}` as placements, or a thrown error naming the variable.
 *
 * Refused rather than ignored, and the message quotes what was typed: a
 * mistyped variable that silently fell back would place children at the
 * campus the runner was built with while the person who typed it believed
 * they had moved them, and the dry run's own summary would agree with them.
 */
export function parsePlacement(raw: string, variable: string): Placement[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${variable} "${raw}" is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${variable} must be an object of class name to campus name, not ${raw}`);
  }
  const out: Placement[] = [];
  for (const [className, campusName] of Object.entries(parsed)) {
    if (typeof campusName !== "string" || !campusName.trim()) {
      throw new Error(`${variable} entry "${className}" must name a campus`);
    }
    out.push({ className, campusName: campusName.trim() });
  }
  return out;
}
