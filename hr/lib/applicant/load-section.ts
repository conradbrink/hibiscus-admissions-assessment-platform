import "server-only";
import { redirect } from "next/navigation";
import { loadApplicantView, type ApplicantView } from "@/lib/applicant/scope";
import { requireApplicantSession } from "@/lib/tokens/server";

/** Every section page starts here: a verified session, the applicant's own view, and still a draft. */
export async function loadDraftView(): Promise<ApplicantView> {
  const session = await requireApplicantSession();
  const view = await loadApplicantView(session);
  if (!view) redirect("/apply/link?expired=1");
  if (view.application.status !== "draft") redirect("/apply");
  return view;
}
