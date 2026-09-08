import type { Metadata } from "next";
import { Fredoka } from "next/font/google";
import { Logo } from "@/components/brand/logo";

/** The story voice needs a rounded, friendly face; the code screen shares it harmlessly. */
const fredoka = Fredoka({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-story" });

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
