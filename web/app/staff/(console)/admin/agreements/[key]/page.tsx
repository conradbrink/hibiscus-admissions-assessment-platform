import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requireStaff } from "@/lib/staff/session";
import { publishAgreement } from "../actions";

export default async function AgreementPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { supabase } = await requireStaff("templates.write");
  const { data: t } = await supabase.from("agreement_templates").select("*").eq("key", key).eq("is_active", true).maybeSingle();
  if (!t) notFound();
  return (
    <>
      <PageTitle title={t.name} description={`${t.key} · version ${t.version}. Saving publishes version ${t.version + 1}.`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ActionForm action={publishAgreement} label="Publish new version" size="sm" className="grid gap-2">
          <input type="hidden" name="key" value={t.key} />
          <Input name="name" defaultValue={t.name} required />
          <Input name="description" defaultValue={t.description ?? ""} placeholder="Description (for staff)" />
          <Input name="documentUrl" defaultValue={t.document_url ?? ""} placeholder="Link to the document: https://…pdf, or /policies/2026/….pdf served by this site (optional)" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" value="1" defaultChecked={t.required} /> Required to enrol</label>
          <Textarea name="bodyHtml" rows={18} defaultValue={t.body_html} className="font-mono text-xs" required />
        </ActionForm>
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Current version, as the parent sees it</p>
          <div className="prose prose-sm max-w-none rounded-xl border border-border bg-white p-6 text-black" dangerouslySetInnerHTML={{ __html: t.body_html }} />
          {t.document_url ? <p className="mt-2 text-xs text-muted-foreground">Parents are offered: <a href={t.document_url} target="_blank" rel="noopener noreferrer" className="underline">{t.document_url}</a></p> : null}
        </div>
      </div>
    </>
  );
}
