/** "Conrad Brink" → "CB"; "conrad@hibiscus.co.bw" → "CO". For the avatar circles. */
export function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.split("@")[0].split(/[\s._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}
