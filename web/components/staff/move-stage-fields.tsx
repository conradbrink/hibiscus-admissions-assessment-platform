"use client";

import { useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { MOVE_TARGETS, type MoveTarget } from "@/lib/workflow/stage-move";

/**
 * The fields inside Move to stage: where to, why, and — only for
 * Registration — whether the family says they have paid. The choice drives
 * the rest, as in `DecisionFields`: the line under the picker says what the
 * move does and what the parent will hear, because that is what the officer
 * is weighing, and a paid box beside a move to Decision is a box they would
 * wonder about.
 *
 * `optional` is the Add an applicant form, where most families are not moved
 * at all: it starts on "do not move", and asks for a reason only once a stage
 * is chosen.
 */
export function MoveStageFields({ targets, optional = false }: { targets: readonly MoveTarget[]; optional?: boolean }) {
  const shown = MOVE_TARGETS.filter((t) => targets.includes(t.key));
  const [target, setTarget] = useState<MoveTarget | "">(optional ? "" : (shown[0]?.key ?? "decision"));
  const chosen = shown.find((t) => t.key === target) ?? null;

  return (
    <div className="space-y-3">
      <label className="block text-xs">
        <span className="mb-1 block font-semibold text-muted-foreground">Move to</span>
        <NativeSelect name="target" value={target} onChange={(e) => setTarget(e.target.value as MoveTarget | "")} className="w-full sm:w-64">
          {optional ? <option value="">Do not move — start at the enquiry</option> : null}
          {shown.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </NativeSelect>
      </label>
      {chosen ? <p className="text-xs text-muted-foreground">{chosen.explain}</p> : null}
      {target === "registration" ? (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" name="alreadyPaid" className="mt-0.5" />
          <span>
            The family says they have already paid. Their payment stays open for finance, who are asked to confirm it. Nothing is marked paid until
            they do.
          </span>
        </label>
      ) : null}
      {chosen ? (
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted-foreground">Why</span>
          <Textarea name="reason" rows={2} required minLength={5} maxLength={1000} placeholder="For example: paid online on 12 October; sibling already at the school, no assessment needed" />
        </label>
      ) : null}
    </div>
  );
}
