import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { createBank } from "./actions";

export default async function QuestionBanksPage() {
  const { supabase } = await requireStaff("assessments.author");
  const [{ data: banks }, { data: counts }] = await Promise.all([
    supabase.from("question_banks").select("*").order("created_at", { ascending: false }),
    supabase.from("questions").select("bank_id, status"),
  ]);
  const tally = new Map<string, { total: number; active: number }>();
  for (const q of counts ?? []) {
    const t = tally.get(q.bank_id) ?? { total: 0, active: 0 };
    t.total += 1;
    if (q.status === "active") t.active += 1;
    tally.set(q.bank_id, t);
  }

  return (
    <>
      <PageTitle
        title="Question banks"
        description="Everything a child can be asked. Questions are authored here and drawn into assessment templates; what a child actually sat is frozen at launch, so editing here never changes a past result."
      />
      <ActionForm action={createBank} label="Create bank" size="sm" className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
        <div className="min-w-56 flex-1"><Input name="name" placeholder="Bank name, e.g. Primary English 2027" required /></div>
        <div className="min-w-56 flex-1"><Input name="description" placeholder="What it covers (optional)" /></div>
      </ActionForm>
      {banks?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {banks.map((b) => {
            const t = tally.get(b.id) ?? { total: 0, active: 0 };
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/admin/question-banks/${b.id}`} className="font-medium hover:underline">{b.name}</Link>
                  {b.is_sample ? <Badge variant="warning" className="ml-2">Sample — not for real sittings</Badge> : null}
                  <p className="text-xs text-muted-foreground">{b.description ?? "—"} · created {formatDate(b.created_at)}</p>
                </div>
                <span className="text-xs text-muted-foreground">{t.active} active of {t.total}</span>
                <Badge variant={b.status === "active" ? "success" : b.status === "retired" ? "muted" : "outline"}>{b.status}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>No banks yet. Create one, then add questions to it.</EmptyState>
      )}
    </>
  );
}
