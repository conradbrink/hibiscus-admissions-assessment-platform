import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format-date";
import { fieldFor, formatSetting, SECTIONS, type SettingField } from "@/lib/settings/fields";
import { requireStaff } from "@/lib/staff/session";
import { saveSetting } from "./actions";

/**
 * The numbers the automation consults, asked for in the words somebody
 * running admissions would use.
 *
 * It was one box per row with the key in monospace and the value as raw
 * JSON — fifty-four of them in alphabetical order, so the payment deadline
 * sat between the payment polling interval and whether a declined child's
 * profile is shared. `lib/settings/fields.ts` says what each one is; this
 * groups them and gives each the control its kind deserves.
 */

type Row = { key: string; value: unknown; description: string | null; updated_at: string };

function Field({ row, field }: { row: Row; field: SettingField }) {
  const shown = formatSetting(field.kind, row.value);
  return (
    <ActionForm
      action={saveSetting}
      label="Save"
      size="xs"
      variant="outline"
      className="grid grid-cols-[1fr_auto] items-start gap-3 surface px-4 py-3 md:grid-cols-[1fr_220px_auto]"
    >
      <input type="hidden" name="key" value={row.key} />
      <div className="min-w-0">
        <p className="text-sm font-medium">{field.label}</p>
        {field.help ?? row.description ? (
          <p className="text-xs text-muted-foreground">{field.help ?? row.description}</p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono">{row.key}</span> · changed {formatDateTime(row.updated_at)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {field.kind === "bool" ? (
          <label className="text-sm">
            <input type="checkbox" name="value" value="1" defaultChecked={shown === "1"} /> on
          </label>
        ) : field.kind === "date" ? (
          <Input type="date" name="value" defaultValue={shown} className="h-8 md:h-8" />
        ) : field.kind === "text" ? (
          <Input name="value" defaultValue={shown} maxLength={2000} className="h-8 md:h-8" />
        ) : (
          <>
            <Input
              name="value"
              defaultValue={shown}
              inputMode={field.kind === "timeList" ? "text" : "numeric"}
              placeholder={field.kind === "timeList" ? "08:00, 10:30" : field.kind.startsWith("intList") ? "7, 2" : ""}
              className="h-8 tabular-nums md:h-8"
            />
            {field.unit ? <span className="shrink-0 text-xs text-muted-foreground">{field.unit}</span> : null}
          </>
        )}
      </div>
    </ActionForm>
  );
}

/** A setting nothing has labelled yet: the old raw box, so it stays editable. */
function RawField({ row }: { row: Row }) {
  return (
    <ActionForm action={saveSetting} label="Save" size="xs" variant="outline" className="grid grid-cols-[1fr_220px_auto] items-center gap-3 surface px-4 py-3">
      <input type="hidden" name="key" value={row.key} />
      <div>
        <p className="font-mono text-sm">{row.key}</p>
        <p className="text-xs text-muted-foreground">{row.description}</p>
        <p className="text-[11px] text-muted-foreground">No form field for this one yet, so it takes JSON. Changed {formatDateTime(row.updated_at)}</p>
      </div>
      <Input name="value" defaultValue={JSON.stringify(row.value)} className="h-8 font-mono md:h-8" />
    </ActionForm>
  );
}

export default async function SettingsPage() {
  const { supabase } = await requireStaff("settings.write");
  const { data } = await supabase.from("settings").select("*").order("key");
  const rows = (data ?? []) as Row[];

  const bySection = new Map<string, Row[]>();
  const unlabelled: Row[] = [];
  for (const row of rows) {
    const field = fieldFor(row.key);
    if (!field) {
      unlabelled.push(row);
      continue;
    }
    const list = bySection.get(field.section) ?? [];
    list.push(row);
    bySection.set(field.section, list);
  }

  return (
    <>
      <PageTitle
        back={{ href: "/staff/admin", label: "Settings" }}
        title="Workflow settings"
        description="The numbers the automation consults. A change applies to emails, reminders and offers made from here on — a family who already has a date keeps it, and a payment deadline already given to one family is moved on their own Payment tab."
      />

      <div className="space-y-8">
        {SECTIONS.filter((s) => bySection.has(s)).map((section) => (
          <section key={section} className="space-y-2">
            <h2 className="text-sm font-semibold">{section}</h2>
            {(bySection.get(section) ?? []).map((row) => (
              <Field key={row.key} row={row} field={fieldFor(row.key)!} />
            ))}
          </section>
        ))}

        {unlabelled.length ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Not yet labelled</h2>
            <p className="text-xs text-muted-foreground">
              Added by a migration and not yet given a plain-language field. They still save, as JSON.
            </p>
            {unlabelled.map((row) => <RawField key={row.key} row={row} />)}
          </section>
        ) : null}
      </div>
    </>
  );
}
