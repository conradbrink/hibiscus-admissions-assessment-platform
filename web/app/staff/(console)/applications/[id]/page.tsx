import { notFound } from "next/navigation";
import { ApplicantWorkspaceView } from "@/components/staff/applicant/workspace-view";
import { requireStaff } from "@/lib/staff/session";
import { loadApplicantWorkspace } from "./load";

/**
 * One applicant, as the staff member's workspace: read here, laid out by
 * `ApplicantWorkspaceView`, where the order of the page is explained.
 */
export default async function ApplicantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("applications.read");
  const w = await loadApplicantWorkspace(supabase, permissions, id);
  if (!w) notFound();
  return <ApplicantWorkspaceView w={w} permissions={permissions} />;
}
