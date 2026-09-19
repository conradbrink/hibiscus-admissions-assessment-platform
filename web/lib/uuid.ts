/**
 * Whether a string is shaped like a uuid. For a value that arrives from a
 * URL and is about to be written into a PostgREST filter string, where a
 * comma or a dot would be read as syntax rather than compared as a value.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}
