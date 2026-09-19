import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_LABELS, ACTION_TYPES, describeAction, parseActions, TRIGGER_LABELS } from "@/lib/crm/automations/rules";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import { createAutomation, toggleAutomation } from "./actions";

/**
 * When this happens, do these. The engine's own switch is shown first,
 * because every automation is off until both it and the engine are on.
 */
export default async function AutomationsPage() {
  const { supabase, permissions } = await requireStaff("crm.read");
  const canEdit = can(permissions, "settings.write");
  const [{ data: rows }, settings, { data: recent }] = await Promise.all([
    supabase.from("automations").select("*").order("sort_order").order("name"),
    getSettings(supabase),
    supabase.from("automation_runs").select("id, status, ran_at, error, family_id, automations(name)").order("id", { ascending: false }).limit(20),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  return (
    <>
      <PageTitle title="Automations" description="When something happens to a family, the CRM can act. Each automation has its own switch, and the engine has one too." />
      <p className={`mb-4 rounded-xl px-4 py-2 text-sm ${settings.crmAutomationsEnabled ? "bg-success/10" : "bg-warning/15"}`}>
        The automation engine is <strong>{settings.crmAutomationsEnabled ? "on" : "off"}</strong>.{" "}
        {settings.crmAutomationsEnabled ? "Active automations run from the job drain within five minutes of the event." : "Nothing runs until crm_automations_enabled is switched on under Admissions → Settings → Workflow settings."}
      </p>
      {rows?.length ? (
        <ul className="space-y-2">
          {rows.map((a) => {
            const parsed = parseActions(a.actions);
            return (
              <li key={a.id} className="surface flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/crm/automations/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
                  <span className="ml-2 text-xs text-muted-foreground">{TRIGGER_LABELS[a.trigger_type]}</span>
                  {a.description ? <p className="text-xs text-muted-foreground">{a.description}</p> : null}
                  <ol className="mt-1 list-decimal pl-5 text-xs text-muted-foreground">{parsed.ok ? parsed.actions.map((x, i) => <li key={i}>{describeAction(x)}</li>) : <li className="text-destructive">Actions are not valid.</li>}</ol>
                  <p className="mt-1 text-[11px] text-muted-foreground">Ran {a.run_count} time{a.run_count === 1 ? "" : "s"}{a.last_run_at ? `, last ${formatDateTime(a.last_run_at)}` : ""}.</p>
                </div>
                <Badge variant={a.is_active ? "success" : "muted"}>{a.is_active ? "On" : "Off"}</Badge>
                {canEdit ? (
                  <ActionForm action={toggleAutomation} label={a.is_active ? "Switch off" : "Switch on"} size="xs" variant="outline" confirm={a.is_active ? undefined : `Switch on "${a.name}"? It will act on every matching event from now on.`}>
                    <input type="hidden" name="automationId" value={a.id} />
                    <input type="hidden" name="active" value={a.is_active ? "off" : "on"} />
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <EmptyState>No automations.</EmptyState>}

      {recent?.length ? (
        <section className="surface mt-6">
          <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">Recent runs</h2></div>
          <ul className="divide-y divide-border/70 text-xs">
            {recent.map((r) => (
              <li key={r.id} className="flex gap-3 px-5 py-2">
                <span className="w-32 shrink-0 text-muted-foreground">{formatDateTime(r.ran_at)}</span>
                <span className="min-w-0 flex-1">{one(r.automations)?.name} · <span className={r.status === "failed" ? "text-destructive" : r.status === "done" ? "text-success" : "text-muted-foreground"}>{r.status}</span>{r.error ? ` · ${r.error}` : ""}{r.family_id ? <> · <Link href={`/staff/crm/families/${r.family_id}`} className="underline">family</Link></> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canEdit ? (
        <section className="surface mt-6 p-5">
          <h2 className="text-sm font-semibold">New automation</h2>
          <p className="text-xs text-muted-foreground">Conditions and actions are JSON, in the shapes the seeded ones use. Known actions: {ACTION_TYPES.map((t) => ACTION_LABELS[t]).join(", ")}.</p>
          <ActionForm action={createAutomation} label="Create (switched off)" size="sm" className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input name="code" placeholder="code, e.g. welcome_open_day" required />
            <Input name="name" placeholder="Name" required />
            <NativeSelect name="triggerType" defaultValue="enquiry.created" aria-label="Trigger">{Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
            <Input name="description" placeholder="What it does, in a line" />
            <Textarea name="conditions" rows={3} placeholder={'{"to": ["active"]}'} className="font-mono text-xs sm:col-span-2" />
            <Textarea name="actions" rows={5} placeholder={'[{"type": "create_task", "title": "Ring the family", "due_days": 2, "assign": "assignee"}]'} className="font-mono text-xs sm:col-span-2" required />
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
