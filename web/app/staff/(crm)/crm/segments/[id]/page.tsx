import Link from "next/link";
import { notFound } from "next/navigation";
import { LifecycleBadge } from "@/components/crm/bits";
import { RuleBuilder } from "@/components/crm/rule-builder";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { describeRule } from "@/lib/crm/segments";
import { countSegment, listSegment, parseRules } from "@/lib/crm/segments-server";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { deleteSegment, recountSegment, updateSegment } from "../actions";

/** One segment: its rules, today's count, the first families it matches, and the edit form. */
export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.campaigns.write");
  const { data: segment } = await supabase.from("segments").select("*").eq("id", id).maybeSingle();
  if (!segment) notFound();
  const rules = parseRules(segment.rules);
  const [count, sample, { data: campuses }, { data: grades }, { data: staff }, { data: types }, { data: items }, { data: campaigns }] = await Promise.all([
    countSegment(supabase, rules, segment.campus_id),
    listSegment(supabase, rules, segment.campus_id, 25),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("grades").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("opportunity_types").select("code, name").eq("is_active", true).order("sort_order"),
    supabase.from("optional_items").select("code, label").eq("is_active", true).order("label"),
    supabase.from("campaigns").select("id, name, status").eq("segment_id", id).order("created_at", { ascending: false }),
  ]);
  const lookups = {
    campus: (x: string) => campuses?.find((c) => c.id === x)?.name ?? x,
    grade: (x: string) => grades?.find((g) => g.id === x)?.name ?? x,
    staff: (x: string) => staff?.find((s) => s.id === x)?.full_name ?? x,
  };
  const distinctItems = [...new Map((items ?? []).map((i) => [i.code, i])).values()];

  return (
    <>
      <PageTitle back={{ href: "/staff/crm/segments", label: "Segments" }} title={segment.name} description={segment.description ?? undefined}>
        {canWrite ? <Link href={`/staff/crm/campaigns/new?segment=${id}`} className={buttonVariants({ size: "lg" })}>New campaign to this segment</Link> : null}
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Matching families</p>
                <p className="text-3xl font-semibold tabular-nums">{count}</p>
                <p className="text-xs text-muted-foreground">Counted now, for what you may see.{segment.counted_at ? ` Last saved count ${segment.match_count} at ${formatDateTime(segment.counted_at)}.` : ""}</p>
              </div>
              <ActionForm action={recountSegment} label="Save this count" size="xs" variant="outline"><input type="hidden" name="segmentId" value={id} /></ActionForm>
            </div>
            <ul className="mt-3 space-y-1 text-sm">{rules.map((r, i) => <li key={i}>{i > 0 ? <span className="mr-1 text-[11px] font-semibold text-muted-foreground uppercase">and</span> : null}{describeRule(r, lookups)}</li>)}</ul>
          </section>
          <section className="surface">
            <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">The first {sample.length} of {count}</h2></div>
            {sample.length ? (
              <ul className="divide-y divide-border/70">
                {sample.map((f) => (
                  <li key={f.family_id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
                    <Link href={`/staff/crm/families/${f.family_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{f.display_name ?? f.family_code} family</Link>
                    <span className="text-xs text-muted-foreground">{f.primary_first_name} {f.primary_last_name} · {f.campus_name ?? "—"} · {f.enrolled_count} enrolled</span>
                    <LifecycleBadge stage={f.lifecycle_stage} />
                  </li>
                ))}
              </ul>
            ) : <div className="px-5 pb-5"><EmptyState>No family matches these rules.</EmptyState></div>}
          </section>
          {campaigns?.length ? (
            <section className="surface p-5 text-sm">
              <h2 className="mb-2 font-semibold">Campaigns to this segment</h2>
              <ul>{campaigns.map((c) => <li key={c.id}><Link href={`/staff/crm/campaigns/${c.id}`} className="hover:underline">{c.name}</Link> <span className="text-xs text-muted-foreground">· {c.status}</span></li>)}</ul>
            </section>
          ) : null}
        </div>
        {canWrite ? (
          <div className="space-y-4">
            <ActionForm action={updateSegment} label="Save changes" size="sm" resetOnSubmit={false} className="surface space-y-3 p-5">
              <input type="hidden" name="segmentId" value={id} />
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Name</span><Input name="name" defaultValue={segment.name} required maxLength={120} /></label>
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Description</span><Input name="description" defaultValue={segment.description ?? ""} maxLength={500} /></label>
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus</span>
                <NativeSelect name="campusId" defaultValue={segment.campus_id ?? ""}><option value="">Every campus I can see</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
              </label>
              <RuleBuilder initial={rules} lookups={{ campuses: campuses ?? [], grades: grades ?? [], staff: staff ?? [], opportunityTypes: types ?? [], items: distinctItems }} />
            </ActionForm>
            {!campaigns?.length ? (
              <ActionForm action={deleteSegment} label="Delete segment" size="xs" variant="destructive" confirm="Delete this segment?"><input type="hidden" name="segmentId" value={id} /></ActionForm>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
