import Image from "next/image";

/**
 * The school's logo, as served from the website (hibiscusschools.com) on
 * 7 September 2026 and kept in /public/brand so the site never depends on
 * the website being up. One component so every shell shows the same mark
 * at the same size.
 */
export const LOGO_SRC = "/brand/hibiscus-logo.png";
export const LOGO_ALT = "Hibiscus International Schools";

export function Logo({ className = "h-9 w-auto", priority = true }: { className?: string; priority?: boolean }) {
  return <Image src={LOGO_SRC} alt={LOGO_ALT} width={326} height={148} className={className} priority={priority} />;
}
