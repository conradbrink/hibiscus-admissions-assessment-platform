import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CampusRow, HrVacancyRow } from "@/lib/supabase/types";

/**
 * What the public careers pages may show: published vacancies whose closing
 * date has not passed, and the campus each is at. Read under the service role
 * because visitors are not principals; nothing but these columns leaves.
 */
export type PublicVacancy = Pick<
  HrVacancyRow,
  "id" | "slug" | "title" | "phase" | "subject" | "grade_range" | "employment_type" | "summary" | "description" | "requirements" | "salary_note" | "starts_on" | "closes_on"
> & { campus: Pick<CampusRow, "id" | "name" | "country" | "descriptor"> };

const COLUMNS = "id, slug, title, phase, subject, grade_range, employment_type, summary, description, requirements, salary_note, starts_on, closes_on, campus_id";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function withCampuses(rows: (Omit<PublicVacancy, "campus"> & { campus_id: string })[]): Promise<PublicVacancy[]> {
  if (!rows.length) return [];
  const admin = createAdminClient();
  const { data: campuses } = await admin.from("campuses").select("id, name, country, descriptor").in("id", [...new Set(rows.map((r) => r.campus_id))]);
  const byId = new Map((campuses ?? []).map((c) => [c.id, c]));
  return rows.flatMap(({ campus_id, ...v }) => {
    const campus = byId.get(campus_id);
    return campus ? [{ ...v, campus }] : [];
  });
}

export async function listOpenVacancies(): Promise<PublicVacancy[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hr_vacancies")
    .select(COLUMNS)
    .eq("status", "published")
    .or(`closes_on.is.null,closes_on.gte.${today()}`)
    .order("closes_on", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return withCampuses(data ?? []);
}

export async function getOpenVacancy(slug: string): Promise<PublicVacancy | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.from("hr_vacancies").select(COLUMNS).eq("slug", slug).eq("status", "published").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || (data.closes_on && data.closes_on < today())) return null;
  const [v] = await withCampuses([data]);
  return v ?? null;
}

export const PHASE_LABELS = { preschool: "Pre-school", primary: "Primary", secondary: "Secondary", general: "Support staff" } as const;
export const EMPLOYMENT_LABELS = { permanent: "Permanent", fixed_term: "Fixed term", part_time: "Part time", temporary: "Temporary" } as const;
