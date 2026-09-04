import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FunnelBeacon } from "@/components/parent/funnel-beacon";
import { PageHeader, StepIndicator } from "@/components/parent/page-header";
import { SlotPicker } from "@/components/parent/slot-picker";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { loadAvailableSlots } from "@/lib/enquiry";
import { requireParentSession } from "@/lib/tokens/server";
import { bookSlot } from "../actions";

export const metadata: Metadata = { title: "Choose a time" };

export default async function BookPage() {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const { application: app, campus, grade } = graph;

  // Unrouted enquiries confirm their grade first.
  if (app.status === "new_enquiry" && app.next_action === null) redirect("/next/grade");

  const kind: "assessment" | "visit" =
    app.requires_assessment && app.entry_route !== "visit" ? "assessment" : "visit";
  // Pre-school parents who came through the assessment door can still book
  // a visit; the exempt track never offers an assessment.
  const effectiveKind = app.requires_assessment ? kind : "visit";

  const days = await loadAvailableSlots(admin, {
    campusId: campus.id,
    kind: effectiveKind,
    gradeSort: grade.sort_order,
  });

  const changing = Boolean(graph.booking);

  return (
    <>
      <FunnelBeacon step="slots.viewed" />
      <StepIndicator step={3} total={3} />
      <PageHeader
        title={
          changing
            ? "Choose a new time"
            : effectiveKind === "assessment"
              ? `Choose a time for ${app.child_first_name}'s assessment`
              : `Choose a time to visit ${campus.name}`
        }
        description={
          effectiveKind === "assessment"
            ? `${grade.name} at ${campus.name}. Assessments take between 45 and 90 minutes.`
            : `We will show you around and answer your questions.`
        }
      />
      {days.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="font-semibold">No dates are open at {campus.name} right now.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We have your enquiry. As soon as new dates are published we will email you a link to
            choose one — there is nothing you need to do.
          </p>
          <Link href="/next" className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-2">
            Back to your application
          </Link>
        </div>
      ) : (
        <SlotPicker days={days} action={bookSlot} />
      )}
      {changing ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Your current booking stays in place until you choose a new time.{" "}
          <Link href="/next/booking" className="font-medium text-foreground underline underline-offset-2">
            Keep it
          </Link>
        </p>
      ) : null}
    </>
  );
}
