"use server";

import { redirect } from "next/navigation";
import { StartSchema } from "@/lib/applicant/schemas";
import { HrError } from "@/lib/errors";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getOpenVacancy } from "@/lib/recruitment/public";
import { startApplication } from "@/lib/recruitment/engine";
import { drainSoon } from "@/lib/staff/action-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { startApplicantSession } from "@/lib/tokens/server";

export type StartState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; sent?: boolean };

/**
 * The first step of an application: name, email, consent. Public, so limited
 * per address and per email. A new application opens at once in this
 * browser; an address that already has one gets the link by email instead,
 * so typing someone else's address never opens their application.
 */
export async function startApplicationAction(slug: string, _prev: StartState, formData: FormData): Promise<StartState> {
  const values = {
    first_name: String(formData.get("first_name") ?? ""),
    last_name: String(formData.get("last_name") ?? ""),
    email: String(formData.get("email") ?? ""),
  };
  const parsed = StartSchema.safeParse({
    ...values,
    consent: formData.get("consent") ?? undefined,
    talent_pool: formData.get("talent_pool") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, values };
  }

  const vacancy = await getOpenVacancy(slug);
  if (!vacancy) return { error: "This vacancy is no longer open for applications.", values };

  const admin = createAdminClient();
  const ctx = await requestContext();
  for (const [limit, subject] of [
    [LIMITS.applyStart, `ip:${ctx.ipHash ?? "unknown"}`],
    [LIMITS.applyStartByEmail, `email:${parsed.data.email}`],
  ] as const) {
    const verdict = await enforceRateLimit(admin, limit, subject);
    if (!verdict.ok) return { error: "Too many attempts. Please wait a few minutes and try again.", values };
  }

  let result: Awaited<ReturnType<typeof startApplication>>;
  try {
    result = await startApplication(admin, {
      vacancyId: vacancy.id,
      firstName: parsed.data.first_name,
      lastName: parsed.data.last_name,
      email: parsed.data.email,
      talentPool: parsed.data.talent_pool === "on",
    });
  } catch (e) {
    if (e instanceof HrError) return { error: e.message, values };
    console.error("[apply] start failed", e);
    return { error: "Something went wrong. Please try again.", values };
  }
  drainSoon();
  if (result.kind === "existing") return { sent: true, values };
  await startApplicantSession(result.applicationId);
  redirect("/apply");
}
