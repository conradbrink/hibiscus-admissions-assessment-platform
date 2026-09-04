import Link from "next/link";

/**
 * The parent shell. One narrow column, a wordmark, and nothing to navigate:
 * a parent is never asked to find their way around, only to do the one
 * thing in front of them.
 */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Link href="/join" className="text-base font-bold tracking-tight text-primary">
            Hibiscus Schools
          </Link>
          <span className="text-xs font-medium text-muted-foreground">Admissions</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 sm:py-10">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-lg px-4 py-5 text-xs leading-relaxed text-muted-foreground">
          <p>
            Lost your link?{" "}
            <Link href="/link" className="font-medium text-foreground underline underline-offset-2">
              Request a new one
            </Link>
            . Your details are used only to process this application.
          </p>
        </div>
      </footer>
    </div>
  );
}
