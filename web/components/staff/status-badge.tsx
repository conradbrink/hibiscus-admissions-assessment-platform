import { Badge } from "@/components/ui/badge";
import type { ApplicationStatus, BookingStatus, TaskPriority } from "@/lib/supabase/types";
import { STATUS_LABELS, STATUS_TONE } from "@/lib/workflow/states";

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const tone = STATUS_TONE[status];
  const variant = tone === "default" ? "default" : tone;
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

const BOOKING: Record<BookingStatus, { label: string; variant: "info" | "success" | "warning" | "muted" | "destructive" }> = {
  booked: { label: "Expected", variant: "info" },
  checked_in: { label: "Arrived", variant: "success" },
  in_progress: { label: "In progress", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  no_show: { label: "No-show", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "muted" },
  rescheduled: { label: "Moved", variant: "muted" },
};

export function BookingBadge({ status }: { status: BookingStatus }) {
  const b = BOOKING[status];
  return <Badge variant={b.variant}>{b.label}</Badge>;
}

const PRIORITY: Record<TaskPriority, "muted" | "secondary" | "warning" | "destructive"> = {
  low: "muted",
  normal: "secondary",
  high: "warning",
  urgent: "destructive",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge variant={PRIORITY[priority]}>{priority}</Badge>;
}
