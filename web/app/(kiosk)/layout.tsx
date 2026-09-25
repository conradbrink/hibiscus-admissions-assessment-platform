import type { Metadata } from "next";
import localFont from "next/font/local";
import { Logo } from "@/components/brand/logo";

/**
 * The story voice needs a rounded, friendly face; the code screen shares it
 * harmlessly.
 *
 * Served from the repository rather than `next/font/google`, which fetches
 * from Google at **build** time: on 25 September a CI build failed with
 * "next/font/google queries have exactly one entry" because that fetch did
 * not come back, and a font nobody had touched stopped the whole deploy.
 * A file in the tree cannot fail to download.
 *
 * `fredoka-latin-variable.woff2` is Google Fonts' own latin subset of the
 * Fredoka variable font (v17), the same bytes `next/font/google` was
 * fetching, under the SIL Open Font License beside it. Variable across the
 * whole 300-700 axis, so it covers the four weights this layout used to ask
 * for and costs 29 KB to do it.
 */
const fredoka = localFont({
  src: "../fonts/fredoka-latin-variable.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-story",
});

export const metadata: Metadata = { title: "Hibiscus assessment", robots: { index: false, follow: false } };

/**
 * The lab computer's shell. No navigation, no footer links, nothing a child
 * can wander off into: the one thing on the screen is the assessment.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`flex min-h-dvh flex-col ${fredoka.variable}`}>
      <header className="border-b border-border/60 bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Logo />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
