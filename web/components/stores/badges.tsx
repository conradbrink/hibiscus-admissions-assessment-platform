import { Badge } from "@/components/ui/badge";
import {
  CONDITION_LABELS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_TONE,
  ITEM_TYPE_LABELS,
  MOVEMENT_LABELS,
  MOVEMENT_TONE,
  dueState,
  itemStatus,
  type Condition,
  type ItemBalances,
  type ItemType,
  type MovementType,
} from "@/lib/stores/rules";

/** The small, shared pieces every Stores page draws with. */

export function ItemStatusBadge({ item }: { item: ItemBalances }) {
  const status = itemStatus(item);
  if (item.is_active === false) return <Badge variant="muted">Switched off</Badge>;
  return <Badge variant={ITEM_STATUS_TONE[status]}>{ITEM_STATUS_LABELS[status]}</Badge>;
}

export function ItemTypeBadge({ type }: { type: ItemType }) {
  const short = { reusable: "Reusable", consumable: "Consumable", asset: "Asset" }[type];
  return <Badge variant="outline" title={ITEM_TYPE_LABELS[type]}>{short}</Badge>;
}

export function MovementBadge({ type }: { type: MovementType }) {
  return <Badge variant={MOVEMENT_TONE[type]}>{MOVEMENT_LABELS[type]}</Badge>;
}

export function ConditionBadge({ condition }: { condition: Condition }) {
  return <Badge variant={condition === "good" ? "success" : "warning"}>{CONDITION_LABELS[condition]}</Badge>;
}

/** Overdue in red, due soon in amber, on loan in a neutral colour. */
export function DueBadge({ expected, today, soonDays }: { expected: string; today: string; soonDays?: number }) {
  const due = dueState(expected, today, soonDays);
  return <Badge variant={due.tone}>{due.label}</Badge>;
}
