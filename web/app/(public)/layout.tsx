import { Logo } from "@/components/brand/logo";

/**
 * The shell for pages anybody may open: an event's page, its stall booking,
 * and the tickets a buyer was sent. Wider than the parent column, because an
 * event page is read before anything is asked; and nothing about admissions
 * in it, because most of the people reading it are not applying.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border/60 bg-card print:hidden">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Logo />
          <span className="text-xs font-medium text-muted-foreground">Events</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border/60 print:hidden">
        <div className="mx-auto max-w-4xl px-4 py-5 text-xs leading-relaxed text-muted-foreground">
          <p>Hibiscus International Schools. We use your details only for this event: to send your tickets and to let you in at the gate.</p>
        </div>
      </footer>
    </div>
  );
}
