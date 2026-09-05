"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { normaliseMobile } from "@/lib/contacts";
import { parseMismatchFlags } from "@/lib/documents/compare";
import { drainSoon } from "@/lib/parent/actions";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { loadRegistrationBundle, ensureRegistration } from "@/lib/registration/load";
import { changedFromApplication, prefillRegistration } from "@/lib/registration/prefill";
import { agreementsSchema, emergencySchema, familySchema, issuesToFields, medicalSchema, signatureMatches, studentSchema } from "@/lib/registration/schema";
import { registrationForSession } from "@/lib/registration/session";
import { requestContext } from "@/lib/request";
import type { RegisterFormState } from "@/components/parent/register/field";
import type { Database } from "@/lib/supabase/types";
import { PARENT_ACTOR, WorkflowError } from "@/lib/workflow/engine";
import { onRegistrationSaved, onRegistrationSubmitted } from "@/lib/workflow/registration-actions";

/**
 * One action per step. Each re-reads the session, refuses when the
 * registration is not open, validates with the shared schema, writes the
 * section, records the save through the engine, and moves to the next step.
 */

function valuesOf(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

async function openSession() {
  const s = await registrationForSession();
  if (!s.editable) redirect("/register/review");
  const verdict = await enforceRateLimit(s.admin, LIMITS.registrationSave, s.graph.application.id);
  if (!verdict.ok) throw new WorkflowError("Please wait a moment and try again.", "database");
  return s;
}

function failed(e: unknown, values: Record<string, string>): RegisterFormState {
  if (e instanceof WorkflowError) return { error: e.message, values };
  console.error("[register] save failed", e);
  return { error: "Something went wrong. Please try again.", values };
}

export async function saveStudent(_prev: RegisterFormState, formData: FormData): Promise<RegisterFormState> {
  const values = valuesOf(formData);
  const parsed = studentSchema.safeParse(values);
  if (!parsed.success) return { fields: issuesToFields(parsed.error), values };
  try {
    const { admin, graph, bundle } = await openSession();
    await ensureRegistration(admin, graph.application.id);
    const d = parsed.data;
    const { error } = await admin
      .from("registrations")
      .update({
        legal_first_name: d.legalFirstName,
        legal_middle_names: d.legalMiddleNames,
        legal_last_name: d.legalLastName,
        preferred_name: d.preferredName,
        gender: d.gender,
        date_of_birth: d.dateOfBirth,
        nationality: d.nationality,
        country_of_birth: d.countryOfBirth,
        place_of_birth: d.placeOfBirth,
        home_language: d.homeLanguage,
        identity_type: d.identityType,
        identity_number: d.identityNumber,
        previous_institution: d.previousInstitution,
        current_grade: d.currentGrade,
        student_completed_at: new Date().toISOString(),
        prefill_changed: changedFromApplication(graph.application, d),
        // The parent has looked at the document check and saved: the flags are answered.
        mismatch_flags: [],
        // Parent-effort metric: how much of this section we could fill for them, and how much they changed.
        prefilled_count: prefillRegistration(graph, null, null).prefilledFields.length,
        prefill_changed_count: changedFromApplication(graph.application, d).length,
      })
      .eq("application_id", graph.application.id);
    if (error) throw new WorkflowError(error.message, "database");
    const hadFlags = parseMismatchFlags(bundle.registration?.mismatch_flags).length > 0;
    await onRegistrationSaved(admin, graph.application, "student", changedFromApplication(graph.application, d), PARENT_ACTOR, { clearedMismatch: hadFlags });
  } catch (e) {
    return failed(e, values);
  }
  redirect("/register/medical");
}

export async function saveMedical(_prev: RegisterFormState, formData: FormData): Promise<RegisterFormState> {
  const values = valuesOf(formData);
  const parsed = medicalSchema.safeParse(values);
  if (!parsed.success) return { fields: issuesToFields(parsed.error), values };
  try {
    const { admin, graph } = await openSession();
    await ensureRegistration(admin, graph.application.id);
    const d = parsed.data;
    const { error } = await admin
      .from("registrations")
      .update({
        medical_aid_name: d.medicalAidName,
        medical_aid_number: d.medicalAidNumber,
        medical_aid_principal_member: d.medicalAidPrincipalMember,
        emergency_treatment_consent: d.emergencyTreatmentConsent === "yes",
        allergies: d.allergies,
        medical_conditions: d.medicalConditions,
        medication: d.medication,
        medical_notes: d.medicalNotes,
        vaccination_notes: d.vaccinationNotes,
        medical_completed_at: new Date().toISOString(),
      })
      .eq("application_id", graph.application.id);
    if (error) throw new WorkflowError(error.message, "database");
    await onRegistrationSaved(admin, graph.application, "medical", [], PARENT_ACTOR);
  } catch (e) {
    return failed(e, values);
  }
  redirect("/register/family");
}

/** Nested form names ("primary.firstName") into the object the schema expects. */
function nest(values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const [head, tail] = k.split(".");
    if (tail) {
      const group = (out[head] ??= {}) as Record<string, string>;
      group[tail] = v;
    } else out[head] = v;
  }
  return out;
}

export async function saveFamily(_prev: RegisterFormState, formData: FormData): Promise<RegisterFormState> {
  const values = valuesOf(formData);
  const parsed = familySchema.safeParse(nest(values));
  if (!parsed.success) return { fields: issuesToFields(parsed.error), values };
  try {
    const { admin, graph } = await openSession();
    await ensureRegistration(admin, graph.application.id);
    const d = parsed.data;
    const appId = graph.application.id;
    const rows: Array<Database["public"]["Tables"]["registration_contacts"]["Insert"]> = [
      {
        application_id: appId,
        kind: "primary_guardian",
        position: 1,
        contact_id: graph.contact.id,
        first_name: d.primary.firstName,
        last_name: d.primary.lastName,
        relationship: d.primary.relationship,
        email: d.primary.email,
        mobile: d.primary.mobile,
        mobile_normalised: normaliseMobile(d.primary.mobile),
        phone: d.primary.phone,
        address: d.primary.address,
        nationality: d.primary.nationality,
      },
    ];
    const hasSecondary = !!(d.secondaryFirstName && d.secondaryLastName && d.secondaryRelationship);
    if (hasSecondary) {
      rows.push({
        application_id: appId,
        kind: "secondary_guardian",
        position: 1,
        contact_id: null,
        first_name: d.secondaryFirstName!,
        last_name: d.secondaryLastName!,
        relationship: d.secondaryRelationship!,
        email: d.secondaryEmail,
        mobile: d.secondaryMobile,
        mobile_normalised: normaliseMobile(d.secondaryMobile),
        phone: d.secondaryPhone,
        address: d.secondaryAddress,
        nationality: d.secondaryNationality,
      });
    }
    const { error } = await admin.from("registration_contacts").upsert(rows, { onConflict: "application_id,kind,position" });
    if (error) throw new WorkflowError(error.message, "database");
    if (!hasSecondary) await admin.from("registration_contacts").delete().eq("application_id", appId).eq("kind", "secondary_guardian");
    // The Phase 1 guardians table finally gets its row: the enquiring contact, as the primary guardian.
    await admin.from("application_guardians").upsert({ application_id: appId, contact_id: graph.contact.id, relationship: d.primary.relationship, is_primary: true }, { onConflict: "application_id,contact_id" });
    // The WhatsApp choice, restated on this step, is the contact's to change either way.
    const wantsWhatsApp = values.whatsappOptIn === "1";
    if (wantsWhatsApp !== graph.contact.whatsapp_opt_in) {
      await admin
        .from("contacts")
        .update(
          wantsWhatsApp
            ? { whatsapp_opt_in: true, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_in_source: "registration", whatsapp_opt_out_at: null }
            : { whatsapp_opt_in: false, whatsapp_opt_out_at: new Date().toISOString() }
        )
        .eq("id", graph.contact.id);
    }
    await admin.from("registrations").update({ family_completed_at: new Date().toISOString() }).eq("application_id", appId);
    await onRegistrationSaved(admin, graph.application, "family", [], PARENT_ACTOR);
  } catch (e) {
    return failed(e, values);
  }
  redirect("/register/emergency");
}

export async function saveEmergency(_prev: RegisterFormState, formData: FormData): Promise<RegisterFormState> {
  const values = valuesOf(formData);
  const contacts = [1, 2]
    .map((i) => ({
      firstName: values[`c${i}.firstName`] ?? "",
      lastName: values[`c${i}.lastName`] ?? "",
      relationship: values[`c${i}.relationship`] ?? "",
      phone: values[`c${i}.phone`] ?? "",
      email: values[`c${i}.email`] ?? "",
      address: values[`c${i}.address`] ?? "",
    }))
    .filter((c, i) => i === 0 || Object.values(c).some((v) => v.trim() !== ""));
  const parsed = emergencySchema.safeParse({ contacts });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(issuesToFields(parsed.error))) fields[k.replace(/^contacts\.(\d+)\./, (_m, n) => `c${Number(n) + 1}.`)] = v;
    return { fields, values };
  }
  try {
    const { admin, graph } = await openSession();
    await ensureRegistration(admin, graph.application.id);
    const appId = graph.application.id;
    await admin.from("registration_contacts").delete().eq("application_id", appId).eq("kind", "emergency");
    const { error } = await admin.from("registration_contacts").insert(
      parsed.data.contacts.map((c, i) => ({
        application_id: appId,
        kind: "emergency" as const,
        position: i + 1,
        first_name: c.firstName,
        last_name: c.lastName,
        relationship: c.relationship,
        phone: c.phone,
        mobile_normalised: normaliseMobile(c.phone),
        email: c.email,
        address: c.address,
      }))
    );
    if (error) throw new WorkflowError(error.message, "database");
    await admin.from("registrations").update({ emergency_completed_at: new Date().toISOString() }).eq("application_id", appId);
    await onRegistrationSaved(admin, graph.application, "emergency", [], PARENT_ACTOR);
  } catch (e) {
    return failed(e, values);
  }
  redirect("/register/documents");
}

export async function continueFromDocuments(): Promise<RegisterFormState> {
  try {
    const { admin, graph } = await openSession();
    await ensureRegistration(admin, graph.application.id);
    await admin.from("registrations").update({ documents_completed_at: new Date().toISOString() }).eq("application_id", graph.application.id);
    await onRegistrationSaved(admin, graph.application, "documents", [], PARENT_ACTOR);
  } catch (e) {
    return failed(e, {});
  }
  redirect("/register/agreements");
}

export async function acceptAgreements(_prev: RegisterFormState, formData: FormData): Promise<RegisterFormState> {
  const values = valuesOf(formData);
  const acceptedKeys = Object.keys(values).filter((k) => k.startsWith("agree_") && values[k] === "1").map((k) => k.slice("agree_".length));
  const parsed = agreementsSchema.safeParse({ signatureName: values.signatureName ?? "", acceptedKeys });
  if (!parsed.success) return { fields: issuesToFields(parsed.error), values };
  try {
    const { admin, graph, bundle } = await openSession();
    const primary = bundle.contacts.find((c) => c.kind === "primary_guardian");
    const first = primary?.first_name ?? graph.contact.first_name;
    const last = primary?.last_name ?? graph.contact.last_name;
    if (!signatureMatches(parsed.data.signatureName, first, last)) {
      return { fields: { signatureName: `Please type your full name, ${first} ${last}, exactly as it appears above.` }, values };
    }
    const required = bundle.agreementTemplates.filter((t) => t.required);
    const missing = required.filter((t) => !parsed.data.acceptedKeys.includes(t.key));
    if (missing.length) {
      const fields: Record<string, string> = {};
      for (const t of missing) fields[`agree_${t.key}`] = "Please tick to accept.";
      return { fields, values };
    }
    const ctx = await requestContext();
    const accepted = bundle.agreementTemplates.filter((t) => parsed.data.acceptedKeys.includes(t.key));
    const { error } = await admin.from("agreement_acceptances").upsert(
      accepted.map((t) => ({
        application_id: graph.application.id,
        agreement_template_id: t.id,
        template_key: t.key,
        template_version: t.version,
        body_hash: createHash("sha256").update(t.body_html).digest("base64url"),
        signature_name: parsed.data.signatureName,
        ip_hash: ctx.ipHash,
        user_agent: ctx.userAgent,
      })),
      { onConflict: "application_id,agreement_template_id", ignoreDuplicates: true }
    );
    if (error) throw new WorkflowError(error.message, "database");
    await ensureRegistration(admin, graph.application.id);
    await admin.from("registrations").update({ agreements_completed_at: new Date().toISOString() }).eq("application_id", graph.application.id);
    await onRegistrationSaved(admin, graph.application, "agreements", [], PARENT_ACTOR);
  } catch (e) {
    return failed(e, values);
  }
  redirect("/register/review");
}

export async function submitRegistration(): Promise<RegisterFormState> {
  try {
    const { admin, graph } = await openSession();
    const bundle = await loadRegistrationBundle(admin, graph);
    const ctx = await requestContext();
    await onRegistrationSubmitted(admin, graph, bundle.completeness, { ipHash: ctx.ipHash }, PARENT_ACTOR);
  } catch (e) {
    return failed(e, {});
  }
  drainSoon();
  redirect("/register/done");
}
