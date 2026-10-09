import type { PayrollRunStatus } from "@/lib/supabase/types";

export const RUN_STATUS: Record<PayrollRunStatus, { label: string; tone: "muted" | "warning" | "success" | "info" }> = {
  draft: { label: "Not worked out yet", tone: "muted" },
  calculated: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  locked: { label: "Paid and locked", tone: "info" },
};
