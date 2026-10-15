/**
 * A registration form's posted fields, grouped the way the schemas expect:
 * "primary.firstName" and "secondary.firstName" become `{ primary: { firstName },
 * secondary: { firstName } }`.
 *
 * The names come from the request, so they are not trusted. A field called
 * `__proto__.isStaff` used to write onto `Object.prototype` for the whole
 * server process, because `out["__proto__"]` is the prototype and never
 * empty. Those names are dropped, and a group only ever goes into an object
 * this function made.
 */
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

export function nest(values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const [head, tail] = k.split(".");
    if (UNSAFE.has(head) || (tail !== undefined && UNSAFE.has(tail))) continue;
    if (tail === undefined) {
      // A plain field never replaces a group of the same name.
      if (!(Object.hasOwn(out, head) && typeof out[head] === "object")) out[head] = v;
      continue;
    }
    const existing = Object.hasOwn(out, head) ? out[head] : undefined;
    const group = existing && typeof existing === "object" ? (existing as Record<string, string>) : {};
    group[tail] = v;
    out[head] = group;
  }
  return out;
}
