import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/**
 * The school transport shell: the parent shell's narrow column, with its own
 * label and footer. Its own route group rather than a page under `(parent)`,
 * whose header says "Admissions" and whose footer talks about an application
 * and a lost link — neither of which a parent booking the shuttle has.
 */
export default function TransportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Link href="/transport" aria-label="Hibiscus International Schools: school transport">
            <Logo />
          </Link>
          <span className="text-xs font-medium text-muted-foreground">School transport</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 sm:py-10">{children}</main>
      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-lg px-4 py-5 text-xs leading-relaxed text-muted-foreground">
          <p>
            We use your details only to arrange school transport. We share the children&rsquo;s names, school, days and
            your address and mobile with the transport provider so they can plan the routes.
          </p>
        </div>
      </footer>
    </div>
  );
}
