import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * Every page starts the same way: a large title, one plain sentence under
 * it, and the page's actions on the right. `back` is the one link a
 * settings page needs to find its way home.
 */
export function PageTitle({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back ? (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <ChevronLeft className="size-3.5" aria-hidden /> {back.label}
          </Link>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
