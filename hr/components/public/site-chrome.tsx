import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/** The header and footer of every public page: the logo, one way home, and nothing else to distract. */
export function SiteHeader({ section = "Careers" }: { section?: string }) {
  return (
    <header className="border-b border-border/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/vacancies" className="flex items-center gap-3 rounded-md focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
          <Logo className="h-9 w-auto" />
          <span className="hidden border-l border-border pl-3 text-sm font-medium text-muted-foreground sm:block">{section}</span>
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-navy text-white/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>Hibiscus International Schools · Human Resources</p>
        <Link href="/staff/login" className="rounded-sm text-white underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-white/40 focus-visible:outline-none">
          Staff sign in
        </Link>
      </div>
    </footer>
  );
}
