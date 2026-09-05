import Link from "next/link";
import { PageHeader, StepIndicator } from "@/components/parent/page-header";
import { SECTIONS, type Section } from "@/lib/registration/completeness";

export const STEP_ORDER: Array<Section | "review"> = [...SECTIONS, "review"];

/** The registration pages share one frame: progress, a heading, and a way back. */
export function RegisterShell({
  step,
  title,
  description,
  children,
  readOnly = false,
}: {
  step: Section | "review";
  title: string;
  description?: string;
  children: React.ReactNode;
  readOnly?: boolean;
}) {
  const index = STEP_ORDER.indexOf(step) + 1;
  return (
    <>
      <StepIndicator step={index} total={STEP_ORDER.length} />
      <PageHeader eyebrow="Registration" title={title} description={description} />
      {readOnly ? (
        <p className="mb-4 rounded-2xl bg-success/10 p-4 text-sm">Registration has been submitted. What you entered is shown here; contact admissions if something needs to change.</p>
      ) : null}
      {children}
      <p className="mt-6 text-sm"><Link href="/register" className="font-medium text-primary underline underline-offset-2">Registration overview</Link> · <Link href="/next" className="font-medium text-primary underline underline-offset-2">Your application</Link></p>
    </>
  );
}
