import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { describeAction, parseActions, TRIGGER_LABELS } from "@/lib/crm/automations/rules";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { toggleAutomation, updateAutomation } from "../actions";

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("crm.read");
  const canEdit = can(permissions, "settings.write");
  const { data: a } = await supabase.from("automations").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();
  const { data: runs } = await supabase.from("automation_runs").select("*").eq("automation_id", id).order("id", { ascending: false }).limit(100);
  const parsed = parseActions(a.actions);
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/automations", label: "Automations" }} title={a.name} description={`${TRIGGER_LABELS[a.trigger_type]} · code ${a.code}`}>
        <Badge variant={a.is_active ? "success" : "muted"}>{a.is_active ? "On" : "Off"}</Badge>
        {canEdit ? <ActionForm action={toggleAutomation} label={a.is_active ? "Switch off" : "Switch on"} size="sm" variant="outline"><input type="hidden" name="automationId" value={a.id} /><input type="hidden" name="active" value={a.is_active ? "off" : "on"} /></ActionForm> : null}
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="text-sm font-semibold">What it does</h2>
          {a.description ? <p className="mt-1 text-sm text-muted-foreground">{a.description}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">Conditions: <code>{JSON.stringify(a.conditions)}</code></p>
          <ol className="mt-2 list-decimal pl-5 text-sm">{parsed.ok ? parsed.actions.map((x, i) => <li key={i}>{describeAction(x)}</li>) : <li className="text-destructive">Actions are not valid: {parsed.problems.map((p) => p.message).join(" ")}</li>}</ol>
          {canEdit ? (
            <ActionForm action={updateAutomation} label="Save" size="sm" resetOnSubmit={false} className="mt-4 grid gap-2">
              <input type="hidden" name="automationId" value={a.id} />
              <input type="hidden" name="code" value={a.code} />
              <Input name="name" defaultValue={a.name} required />
              <Input name="description" defaultValue={a.description ?? ""} />
              <NativeSelect name="triggerType" defaultValue={a.trigger_type} aria-label="Trigger">{Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
              <Textarea name="conditions" rows={3} defaultValue={JSON.stringify(a.conditions, null, 2)} className="font-mono text-xs" />
              <Textarea name="actions" rows={8} defaultValue={JSON.stringify(a.actions, null, 2)} className="font-mono text-xs" required />
            </ActionForm>
          ) : null}
        </section>
        <section className="surface">
          <div className="px-5 pt-4 pb-2"><h2 className="text-sm font-semibold">Runs</h2><p className="text-xs text-muted-foreground">Every event it was offered, including the ones its conditions turned down.</p></div>
          {runs?.length ? (
            <ul className="max-h-[70vh] divide-y divide-border/70 overflow-y-auto text-xs">
              {runs.map((r) => (
                <li key={r.id} className="px-5 py-2">
                  <span className="text-muted-foreground">{formatDateTime(r.ran_at)}</span> · <span className={r.status === "failed" ? "text-destructive" : r.status === "done" ? "text-success" : "text-muted-foreground"}>{r.status}</span>
                  {r.family_id ? <> · <Link href={`/staff/crm/families/${r.family_id}`} className="underline">family</Link></> : null}
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{JSON.stringify(r.log)}</pre>
                </li>
              ))}
            </ul>
          ) : <div className="px-5 pb-5"><EmptyState>Never run.</EmptyState></div>}
        </section>
      </div>
    </>
  );
}
