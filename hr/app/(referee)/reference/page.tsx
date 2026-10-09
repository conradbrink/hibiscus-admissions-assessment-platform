import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReferenceForm } from "@/components/referee/reference-form";
import { loadRefereeView } from "@/lib/references/scope";
import { requireRefereeSession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "Give a reference" };

export default async function ReferencePage() {
  const session = await requireRefereeSession();
  const view = await loadRefereeView(session);
  if (!view || !view.open) redirect("/reference/expired");
  return (
    <div className="pb-8">
      <span aria-hidden className="mb-6 block h-1 w-12 rounded-full bg-[var(--brand-mark)]" />
      <h1 className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">A reference for {view.applicantName}</h1>
      <p className="mt-3 max-w-[60ch] text-[16px] text-muted-foreground text-pretty">
        Dear {view.refereeName}, {view.applicantName} has applied for <span className="font-medium text-foreground">{view.vacancyTitle}</span> at Hibiscus International Schools and gave your name. This takes about four minutes. The applicant will not see your answers.
      </p>
      <div className="mt-10">
        <ReferenceForm applicantName={view.applicantName} statedJob={view.statedJob} relationship={view.relationship} />
      </div>
      <p className="mt-8 text-xs text-muted-foreground">This page is personal to you. If it times out, open the link in your email again.</p>
    </div>
  );
}
