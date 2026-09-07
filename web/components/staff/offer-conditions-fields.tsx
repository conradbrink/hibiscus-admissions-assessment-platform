import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { OFFER_CONDITIONS } from "@/lib/offers/conditions";

/**
 * The conditions a member of staff can attach to an offer: the school's
 * standard list as tick boxes (with a stage or subject where one is needed)
 * and a box for anything else. Plain HTML inside an ActionForm, so it works
 * on every page that generates or re-drafts an offer.
 */
export function OfferConditionsFields({
  grades,
  currentGradeSort,
  compact = false,
}: {
  grades: Array<{ id: string; name: string; sort_order: number }>;
  /** The grade applied for: only lower stages are offered for "lower stage". */
  currentGradeSort: number;
  compact?: boolean;
}) {
  const lower = grades.filter((g) => g.sort_order < currentGradeSort);
  return (
    <fieldset className={compact ? "w-full space-y-2" : "w-full space-y-3 rounded-lg border border-dashed border-border p-3"}>
      <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">Conditions (optional)</legend>
      <ul className="grid gap-x-4 gap-y-1.5 text-sm md:grid-cols-2">
        {OFFER_CONDITIONS.map((c) => (
          <li key={c.key} className="space-y-1">
            <label className="flex items-start gap-2">
              <input type="checkbox" name={`cond_${c.key}`} value="1" className="mt-1 size-4 accent-primary" />
              <span>
                <span className="font-medium">{c.label}</span>
                {c.hint ? <span className="block text-xs text-muted-foreground">{c.hint}</span> : null}
              </span>
            </label>
            {c.detail === "grade" ? (
              <NativeSelect name={`detail_${c.key}`} defaultValue="" className="ml-6 h-8 w-56 md:h-8" aria-label={c.detailLabel}>
                <option value="">{lower.length ? c.detailLabel : "No lower stage at this school"}</option>
                {lower.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </NativeSelect>
            ) : c.detail === "text" ? (
              <Input name={`detail_${c.key}`} placeholder={c.detailLabel} maxLength={120} className="ml-6 h-8 w-56 md:h-8" aria-label={c.detailLabel} />
            ) : null}
          </li>
        ))}
      </ul>
      <Textarea name="conditionsOther" rows={2} maxLength={1000} placeholder="Any other condition, in a sentence the parent will read" className="text-sm" />
    </fieldset>
  );
}
