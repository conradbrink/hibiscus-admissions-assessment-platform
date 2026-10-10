import type { Viewport } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/**
 * The website's two faces, served from the repository for the same reason
 * as the kiosk's (see app/fonts/README.md): `next/font/google` fetches at
 * build time, and on 25 September that fetch failing stopped a deploy.
 * Open Sans for reading, Poppins for headings and buttons, latin subsets
 * only, at the weights hibiscusschools.com itself uses.
 */
const openSans = localFont({
  src: [
    { path: "../fonts/open-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/open-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/open-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-open-sans",
});

const poppins = localFont({
  src: [
    { path: "../fonts/poppins-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../fonts/poppins-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-poppins",
});

// The website's navy, for the phone's browser bar. The console keeps the
// root layout's colour.
export const viewport: Viewport = { themeColor: "#172033" };

/**
 * The parent shell, dressed as hibiscusschools.com: the website's white
 * header and navy footer around one narrow column, and nothing to navigate.
 * A parent is never asked to find their way around, only to do the one
 * thing in front of them. `theme-parent` (app/globals.css) swaps in the
 * website's colours and type for everything inside.
 */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`theme-parent ${openSans.variable} ${poppins.variable} flex min-h-dvh flex-col bg-background`}>
      <header className="sticky top-0 z-40 border-b border-border bg-white/93 backdrop-blur-[14px]">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:min-h-20 sm:px-6">
          <Link href="/join" aria-label="Hibiscus International Schools" className="shrink-0 rounded-md">
            <Logo className="h-11 w-auto sm:h-14" />
          </Link>
          <span className="text-[0.71875rem] font-semibold tracking-[0.16em] text-navy uppercase">Admissions</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:py-12">{children}</main>
      <footer className="mt-8 bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="inline-flex w-fit rounded-[10px] bg-white px-3 py-2">
            <Logo className="h-8 w-auto" priority={false} />
          </span>
          <p className="max-w-md text-sm leading-relaxed text-white/70">
            Lost your link?{" "}
            {/* The website turns footer links green on hover; that green on
                navy is 2.5:1, so this uses its light green tint instead. */}
            <Link
              href="/link"
              className="font-semibold text-white underline underline-offset-2 transition-colors hover:text-[#cde7de]"
            >
              Request a new one
            </Link>
            . Your details are used only to process this application.
          </p>
        </div>
      </footer>
    </div>
  );
}
