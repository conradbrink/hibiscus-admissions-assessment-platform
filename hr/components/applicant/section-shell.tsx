import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** The frame around one section of the form: the way back, the title, one sentence of help. */
export function SectionShell({ title, lead, children }: { title: string; lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pb-8">
      <Link href="/apply" className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
        <ArrowLeft className="size-4" aria-hidden /> All sections
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-balance">{title}</h1>
      <p className="mt-2 max-w-[62ch] text-[16px] text-muted-foreground text-pretty">{lead}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
