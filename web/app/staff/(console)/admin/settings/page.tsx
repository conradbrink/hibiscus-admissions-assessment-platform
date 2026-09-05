import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { saveSetting } from "./actions";

export default async function SettingsPage() {
  const { supabase } = await requireStaff("settings.write");
  const { data: settings } = await supabase.from("settings").select("*").order("key");

  return (
    <>
      <PageTitle title="Workflow settings" description="The numbers the automation consults. Changes apply to emails and reminders queued from now on." />
      <div className="space-y-2">
        {(settings ?? []).map((s) => (
          <ActionForm key={s.key} action={saveSetting} label="Save" size="xs" variant="outline" className="grid grid-cols-[1fr_160px_auto] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <input type="hidden" name="key" value={s.key} />
            <div>
              <p className="font-mono text-sm">{s.key}</p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
              <p className="text-[11px] text-muted-foreground">Updated {formatDateTime(s.updated_at)}</p>
            </div>
            <Input name="value" defaultValue={JSON.stringify(s.value)} className="h-8 font-mono md:h-8" />
          </ActionForm>
        ))}
      </div>
    </>
  );
}
