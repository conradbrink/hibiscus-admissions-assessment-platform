import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { requireStaff } from "@/lib/staff/session";
import { saveStep } from "./actions";

const optionsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const KIND_HINT: Record<string, string> = {
  acknowledge: "The parent presses Done.",
  choice: "The parent picks one of the options.",
  upload: "The parent sends a document.",
  link: "The parent goes somewhere, then tells us they have.",
  action: "The school does it and ticks it off.",
};

/**
 * The checklist itself, edited by the school.
 *
 * Wording, whether a step is required, when it is due and what the choices
 * are all live here. What does not: the code, the kind and the owner.
 * Changing a code would orphan every checklist already carrying it, and
 * changing a kind would leave answers of one shape in a step that now asks
 * another — both are migrations, not settings.
 */
export default async function OnboardingStepsPage() {
  const { supabase } = await requireStaff("settings.write");
  const { data: steps } = await supabase.from("onboarding_steps").select("*").order("sort_order");

  return (
    <>
      <PageTitle
        title="Onboarding checklist"
        description="What a newly enrolled family is asked for, and what the school promises in return. A change reaches children already onboarding."
      />

      <div className="space-y-3">
        {(steps ?? []).map((s) => (
          <div key={s.code} className="surface p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <code className="text-xs text-muted-foreground">{s.code}</code>
              <Badge variant={s.owner === "staff" ? "info" : "muted"}>
                {s.owner === "staff" ? "the school does this" : s.owner === "either" ? "either" : "the family does this"}
              </Badge>
              <Badge variant="outline">{s.kind}</Badge>
              <span className="text-xs text-muted-foreground">{KIND_HINT[s.kind]}</span>
              {!s.is_active ? <Badge variant="warning">not in use</Badge> : null}
            </div>

            <ActionForm action={saveStep} label="Save" variant="outline" size="sm">
              <input type="hidden" name="code" value={s.code} />
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs sm:col-span-2">
                  <span className="mb-1 block text-muted-foreground">What the family sees</span>
                  <input
                    name="label"
                    required
                    maxLength={120}
                    defaultValue={s.label}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                <label className="text-xs sm:col-span-2">
                  <span className="mb-1 block text-muted-foreground">The line underneath</span>
                  <input
                    name="description"
                    maxLength={500}
                    defaultValue={s.description ?? ""}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                {s.kind === "choice" ? (
                  <label className="text-xs sm:col-span-2">
                    <span className="mb-1 block text-muted-foreground">The choices, separated by commas</span>
                    <input
                      name="options"
                      maxLength={500}
                      defaultValue={optionsOf(s.options).join(", ")}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </label>
                ) : null}
                <label className="text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    Due, in days from the first day (−14 means a fortnight before)
                  </span>
                  <input
                    name="dueOffsetDays"
                    inputMode="numeric"
                    defaultValue={s.due_offset_days ?? ""}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                <div className="flex items-end gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="required" defaultChecked={s.required} className="size-4" />
                    <span className="text-muted-foreground">Required</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="isActive" defaultChecked={s.is_active} className="size-4" />
                    <span className="text-muted-foreground">In use</span>
                  </label>
                </div>
              </div>
            </ActionForm>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Turning a step off stops it being asked for. Checklists already carrying it keep their answer,
        because what a family was asked and what they said is a record, not a setting.
      </p>
    </>
  );
}
