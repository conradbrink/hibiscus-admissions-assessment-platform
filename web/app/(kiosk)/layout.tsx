import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hibiscus assessment", robots: { index: false, follow: false } };

/**
 * The lab computer's shell. No navigation, no footer links, nothing a child
 * can wander off into: the one thing on the screen is the assessment.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <span className="text-base font-bold tracking-tight text-primary">Hibiscus Schools</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
