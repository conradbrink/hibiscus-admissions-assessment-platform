"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { IntakeCadence, MonthChoice } from "@/lib/start-month";

/**
 * The campus, and when the child starts — which is a term at most campuses
 * and a month at Potch and Tlokweng. The second question depends on the
 * answer to the first, which is the only reason this is a client component:
 * the form around it stays a plain server action.
 */
export function PlacePicker({
  campuses,
  intakes,
  months,
}: {
  campuses: Array<{ id: string; name: string; cadence: IntakeCadence }>;
  intakes: Array<{ id: string; label: string }>;
  months: MonthChoice[];
}) {
  const [campusId, setCampusId] = useState("");
  const monthly = campuses.find((c) => c.id === campusId)?.cadence === "month";
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="campusId">Campus</Label>
        <NativeSelect id="campusId" name="campusId" required value={campusId} onChange={(e) => setCampusId(e.target.value)}>
          <option value="" disabled>Choose a campus</option>
          {campuses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
      </div>
      {monthly ? (
        <div className="space-y-1">
          <Label htmlFor="startMonth">Starting in</Label>
          <NativeSelect id="startMonth" name="startMonth" required defaultValue={months[0]?.value ?? ""}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">This campus takes children in by the month. The offer letter names the month; the term is worked out from it.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="intakeId">Starting</Label>
          <NativeSelect id="intakeId" name="intakeId" required defaultValue={intakes[0]?.id ?? ""}>
            {intakes.map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </NativeSelect>
        </div>
      )}
    </>
  );
}
