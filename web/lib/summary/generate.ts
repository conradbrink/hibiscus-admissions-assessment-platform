import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiProvider } from "@/lib/ai/provider";
import { parseMismatchFlags } from "@/lib/documents/compare";
import { registrationCompleteness, SECTIONS } from "@/lib/registration/completeness";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationSummaryRow, Database, Json } from "@/lib/supabase/types";
import { summaryFacts, type Flag, type SummaryInputs } from "@/lib/summary/facts";
import { fallbackSummary, inputHash, SUMMARY_PROMPT_VERSION, SUMMARY_SCHEMA, summaryInput, summarySystemPrompt, validateSummary } from "@/lib/summary/narrative";

/**
 * Loads what the facts are computed from, through whichever client the
 * caller holds: the applicant page uses the staff client (so RLS applies),
 * the refresh action uses the admin client after an RLS read.
 */
export async function loadSummaryInputs(client: SupabaseClient<Database>, applicationId: string): Promise<SummaryInputs | null> {
  const { data: app } = await client
    .from("applications")
    .select("*, campuses(name), grades!applications_grade_id_fkey(name, sort_order), intakes(label)")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return null;
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const gradeSort = one(app.grades)?.sort_order ?? 0;

  const [events, booking, attempt, decision, offer, paymentRequest, registration, contacts, documents, requirements, templates, acceptances, tasks, emails, messages, inbound, siblings] = await Promise.all([
    client.from("application_events").select("type, occurred_at, summary").eq("application_id", applicationId).order("id", { ascending: true }).limit(300),
    client.from("bookings").select("session_id, kind, sessions(starts_at)").eq("application_id", applicationId).in("status", ["booked", "checked_in", "in_progress"]).limit(1).maybeSingle(),
    client.from("attempts").select("status, marking_status, submitted_at").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("admission_decisions").select("final_outcome, decided_by, decided_at, override_reason").eq("application_id", applicationId).neq("final_outcome", "staff_review").order("decided_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("offers").select("status, expires_at, sent_at").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("payment_requests").select("status, due_at, amount_minor, paid_minor, currency").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("registrations").select("*").eq("application_id", applicationId).maybeSingle(),
    client.from("registration_contacts").select("*").eq("application_id", applicationId),
    client.from("documents").select("*").eq("application_id", applicationId).is("deleted_at", null),
    client.from("document_requirements").select("*").eq("is_active", true),
    client.from("agreement_templates").select("*").eq("is_active", true),
    client.from("agreement_acceptances").select("*").eq("application_id", applicationId),
    client.from("tasks").select("type, title, due_at, priority").eq("application_id", applicationId).eq("status", "open"),
    client.from("email_messages").select("id", { count: "exact", head: true }).eq("application_id", applicationId).neq("status", "failed"),
    client.from("messages").select("id", { count: "exact", head: true }).eq("application_id", applicationId).eq("direction", "out").in("status", ["sent", "delivered", "read"]),
    client.from("messages").select("received_at").eq("application_id", applicationId).eq("direction", "in").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("applications").select("child_first_name, status").eq("contact_id", app.contact_id).neq("id", applicationId).neq("status", "withdrawn"),
  ]);

  const registrationOpen = ["paid", "registration_incomplete", "registration_complete", "enrolled"].includes(app.status);
  let registrationFacts: SummaryInputs["registration"] = null;
  if (registrationOpen) {
    const c = registrationCompleteness({
      registration: registration.data ?? null,
      contacts: contacts.data ?? [],
      documents: documents.data ?? [],
      requirements: requirements.data ?? [],
      gradeSort,
      agreementTemplates: templates.data ?? [],
      acceptances: acceptances.data ?? [],
    });
    registrationFacts = {
      submitted_at: registration.data?.submitted_at ?? null,
      prefill_changed: Array.isArray(registration.data?.prefill_changed) ? (registration.data.prefill_changed as string[]) : [],
      mismatch_count: parseMismatchFlags(registration.data?.mismatch_flags).length,
      sections_done: SECTIONS.filter((s) => c.sections[s]).length,
      sections_total: SECTIONS.length,
      missing_documents: c.missingDocuments.map((d) => d.label),
      rejected_documents: c.rejectedDocuments.map((d) => d.label),
    };
  }
  const bookingSession = booking.data ? one(booking.data.sessions) : null;

  return {
    now: new Date(),
    application: {
      status: app.status,
      next_action: app.next_action,
      next_action_due_at: app.next_action_due_at,
      created_at: app.created_at,
      child_first_name: app.child_first_name,
      requires_assessment: app.requires_assessment,
      entry_route: app.entry_route,
      source: app.source,
    },
    campus: one(app.campuses)?.name ?? "",
    grade: one(app.grades)?.name ?? "",
    intake: one(app.intakes)?.label ?? "",
    events: events.data ?? [],
    booking: bookingSession ? { starts_at: bookingSession.starts_at, kind: booking.data!.kind } : null,
    attempt: attempt.data ?? null,
    decision: decision.data ?? null,
    offer: offer.data ?? null,
    paymentRequest: paymentRequest.data ?? null,
    registration: registrationFacts,
    openTasks: tasks.data ?? [],
    emailsSent: emails.count ?? 0,
    messagesSent: messages.count ?? 0,
    lastInboundMessageAt: inbound.data?.received_at ?? null,
    siblings: siblings.data ?? [],
  };
}

export type SummaryView = {
  facts: string[];
  flags: Flag[];
  headline: string;
  paragraph: string;
  source: "ai" | "deterministic";
  generatedAt: string | null;
  stale: boolean;
  aiEnabled: boolean;
};

/** What the page shows: live facts and flags, plus stored prose when it is still current, else the deterministic wording. */
export function summaryView(inputs: SummaryInputs, stored: ApplicationSummaryRow | null, aiEnabled: boolean): SummaryView {
  const { facts, flags } = summaryFacts(inputs);
  const hash = inputHash(facts, flags);
  if (stored && stored.input_hash === hash) {
    return { facts, flags, headline: stored.headline, paragraph: stored.paragraph, source: stored.source, generatedAt: stored.generated_at, stale: false, aiEnabled };
  }
  const fb = fallbackSummary(facts, flags);
  return { facts, flags, headline: fb.headline, paragraph: fb.paragraph, source: "deterministic", generatedAt: stored?.generated_at ?? null, stale: !!stored, aiEnabled };
}

/**
 * Regenerates and stores the summary. The facts and flags are always the
 * computed ones; the model, when switched on, writes the prose and the
 * validator decides whether it is kept.
 */
export async function generateSummary(admin: AdminClient, applicationId: string, staffId: string | null): Promise<ApplicationSummaryRow> {
  const inputs = await loadSummaryInputs(admin, applicationId);
  if (!inputs) throw new Error("application missing");
  const { facts, flags } = summaryFacts(inputs);
  const hash = inputHash(facts, flags);
  const settings = await getSettings(admin);
  const fallback = fallbackSummary(facts, flags);
  let prose = fallback;
  let source: "ai" | "deterministic" = "deterministic";
  let model: string | null = null;
  let errors: Json | null = null;

  if (settings.aiSummaryEnabled) {
    const provider = await getAiProvider();
    const result = await provider.generateStructured({
      schema: SUMMARY_SCHEMA,
      system: summarySystemPrompt(),
      input: summaryInput(facts, flags),
      maxTokens: 1200,
      devOutput: () => fallback,
    });
    if (result.ok) {
      const problems = validateSummary(result.output, facts);
      model = result.model;
      if (problems.length === 0) {
        prose = result.output;
        source = "ai";
      } else {
        errors = problems as unknown as Json;
      }
    } else {
      errors = [{ kind: result.reason, detail: result.error ?? "" }] as unknown as Json;
    }
  }

  const { data, error } = await admin
    .from("application_summaries")
    .upsert(
      {
        application_id: applicationId,
        input_hash: hash,
        facts: facts as unknown as Json,
        flags: flags as unknown as Json,
        headline: prose.headline,
        paragraph: prose.paragraph,
        source,
        model,
        prompt_version: SUMMARY_PROMPT_VERSION,
        validation_errors: errors,
        generated_at: new Date().toISOString(),
        generated_by: staffId,
      },
      { onConflict: "application_id" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "summary upsert failed");
  return data;
}
