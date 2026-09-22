import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FunnelBeacon } from "@/components/parent/funnel-beacon";
import { PageHeader, StepIndicator } from "@/components/parent/page-header";
import { SlotPicker } from "@/components/parent/slot-picker";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { deadlinePassed, parseDeadline } from "@/lib/booking/deadline";
import { loadAvailableSlots } from "@/lib/enquiry";
import { formatDateLong, formatTime, withinCutoff } from "@/lib/format-date";
import { nextBookingKind } from "@/lib/booking/kind";
import { bookingNoun } from "@/lib/booking/noun";
import { getSettings } from "@/lib/settings";
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

  // A family through the visit door books a look-around first, and once
  // they have come, the assessment. Any attended visit counts, not only a
  // live one: after a missed sitting the visit is long finished, and the
  // family must still be offered the sitting again rather than a second visit.
  const { data: attendedVisit } =
    app.requires_assessment && app.entry_route === "visit"
      ? await admin.from("bookings").select("id").eq("application_id", app.id).eq("kind", "visit").in("status", ["checked_in", "completed"]).limit(1).maybeSingle()
      : { data: null };
  const kind = nextBookingKind({ requiresAssessment: app.requires_assessment, entryRoute: app.entry_route, visitAttended: Boolean(attendedVisit) });
  const visited = graph.booking?.kind === "visit" && graph.booking.status === "checked_in";
  // Pre-school parents who came through the assessment door can still book
  // a visit; the exempt track never offers an assessment.
  const effectiveKind = app.requires_assessment ? kind : "visit";
  // Same stored kind, three words: a pre-school family books a play date and
  // a scholarship child comes for an interview.
  const scholarship = Boolean(graph.scholarship);
  const noun = bookingNoun({ requiresAssessment: app.requires_assessment, bookingKind: effectiveKind, scholarship });
  const settings = await getSettings(admin);

  // The award runs to a deadline the school has already put to 172 families in
  // writing, so a slot past it cannot be honoured and is not offered. Without
  // this the picker happily sells a family a date in November and the letter
  // is the only thing that knows better.
  const deadline = scholarship ? parseDeadline(settings.scholarshipInterviewDeadline) : null;
  // Whether the window has *closed*, which is not the same as holding a
  // deadline. Every scholarship family holds one; only some are past it, and
  // telling a family whose campus is merely booked out that "interviews closed
  // on 9 October" — a date that has not arrived — would be worse than the
  // ordinary empty state it replaced.
  const closed = deadlinePassed(deadline);

  const days = await loadAvailableSlots(admin, {
    campusId: campus.id,
    kind: effectiveKind,
    gradeSort: grade.sort_order,
    notAfter: deadline,
  });

  // A visit already attended is not the booking being changed: what follows
  // it is a new booking of a different kind.
  const changing = Boolean(graph.booking) && !(visited && effectiveKind === "assessment");
  const locked = graph.booking ? withinCutoff(graph.booking.session.starts_at, settings.rescheduleCutoffHours) : false;
  // After a no-show, name the session they missed so the page reads as a continuation, not a fresh start.
  const { data: missed } = !changing && app.status === "no_show"
    ? await admin.from("bookings").select("sessions(starts_at)").eq("application_id", app.id).eq("status", "no_show").order("updated_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const missedSession = missed ? (Array.isArray(missed.sessions) ? missed.sessions[0] : missed.sessions) : null;
  // The booking that already exists, which is what the cutoff message is
  // about — deliberately not `effectiveKind`, which is the one being made.
  const currentNoun = bookingNoun({ requiresAssessment: app.requires_assessment, bookingKind: graph.booking?.kind ?? null, scholarship });

  return (
    <>
      <FunnelBeacon step="slots.viewed" />
      <StepIndicator step={3} total={3} />
      <PageHeader
        title={
          changing
            ? "Choose a new time"
            : noun === "assessment"
              ? `Choose a time for ${app.child_first_name}'s assessment`
              : noun === "play date"
                ? `Choose a time for ${app.child_first_name}'s play date`
                : noun === "interview"
                  ? `Choose a time for ${app.child_first_name}'s interview`
                  : `Choose a time to visit ${campus.name}`
        }
        description={
          noun === "assessment"
            ? `${grade.name} at ${campus.name}. Assessments take between 45 and 90 minutes.`
            : noun === "play date"
              ? `${grade.name} at ${campus.name}. Come and play, meet the teachers and see the room; the school confirms ${app.child_first_name}'s place afterwards.`
              : noun === "interview"
                ? `${grade.name} at ${campus.name}. A conversation with ${app.child_first_name} and with you — there is no entrance test, and nothing to prepare.`
                : `We will show you around and answer your questions.`
        }
      />
      {missedSession ? (
        <p className="mb-4 rounded-xl bg-muted px-4 py-3 text-sm">
          {app.child_first_name} was booked for {formatDateLong(missedSession.starts_at)} at {formatTime(missedSession.starts_at)} and we missed you. Choose a new time below.
        </p>
      ) : null}
      {locked ? (
        <div className="surface p-5">
          <p className="font-semibold">Your {currentNoun} is less than {settings.rescheduleCutoffHours} hours away.</p>
          <p className="mt-1 text-sm text-muted-foreground">Bookings this close cannot be changed online. Please call {campus.name} and they will help.</p>
          <Link href="/next/booking" className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-2">Back to your booking</Link>
        </div>
      ) : days.length === 0 && closed && deadline ? (
        // The hole `notAfter` would otherwise leave. A scholarship family
        // opening the link after the deadline would have been told "as soon
        // as new dates are published we will email you a link" — a promise
        // the school will not keep, because there are no more interview dates
        // for them. Say what happened and give them somebody to talk to.
        <div className="surface p-5">
          <p className="font-semibold">Interviews closed on {formatDateLong(deadline)}.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            There are no interview times left for {app.child_first_name} at {campus.name}. Please
            speak to us — we would rather hear from you than have you miss the place.
            {campus.phone ? ` Call ${campus.phone}` : ""}
            {campus.phone && campus.whatsapp ? ` or message ${campus.whatsapp}.` : campus.whatsapp ? ` Message us on ${campus.whatsapp}.` : campus.phone ? "." : ""}
          </p>
          <Link href="/next" className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-2">
            Back to your application
          </Link>
        </div>
      ) : days.length === 0 ? (
        <div className="surface p-5">
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
