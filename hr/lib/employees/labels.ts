import type { EmploymentStatus, EmploymentType } from "@/lib/supabase/types";

export const STATUS_LABEL: Record<EmploymentStatus, string> = { active: "Working", on_leave: "On leave", suspended: "Suspended", terminated: "Left" };
export const STATUS_TONE: Record<EmploymentStatus, "success" | "info" | "warning" | "muted"> = { active: "success", on_leave: "info", suspended: "warning", terminated: "muted" };
export const TYPE_LABEL: Record<EmploymentType, string> = { permanent: "Permanent", fixed_term: "Fixed term", part_time: "Part time", temporary: "Temporary" };
