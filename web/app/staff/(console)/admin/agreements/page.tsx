import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { publishAgreement, retireAgreement, updateAgreementScope } from "./actions";

export default async function AgreementsPage() {
  const { supabase } = await requireStaff("templates.write");
  const { data: templates } = await supabase.from("agreement_templates").select("id, key, version, name, description, required, document_url, sort_order, updated_at, grade_sort_min, grade_sort_max, may_decline").eq("is_active", true).order("sort_order").order("name");
  return (
    <>
      <PageTitle back={{ href: "/staff/admin", label: "Settings" }} title="Agreements" description="What a parent signs at registration, by typing their name. Editing the wording publishes a new version; families who already signed keep the version they saw. The grade band and whether a parent may refuse are edited in place, because neither changes anybody's wording. Grades are numbered as on the grades list: Stage 1 is 60, and everything below it is pre-school." />
      <ul className="mb-6 divide-y divide-border surface">
        {(templates ?? []).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <Link href={`/staff/admin/agreements/${t.key}`} className="font-medium hover:underline">{t.name}</Link>
              <span className="ml-2 font-mono text-xs text-muted-foreground">{t.key} · v{t.version}</span>
              <p className="text-muted-foreground">{t.description}</p>
              <p className="text-xs text-muted-foreground">Updated {formatDate(t.updated_at)}{t.document_url ? <> · <a href={t.document_url} target="_blank" rel="noopener noreferrer" className="underline">document</a></> : null}</p>
            </div>
            <Badge variant={t.required ? "warning" : "secondary"}>
              {!t.required ? "optional" : t.may_decline ? "must answer, may refuse" : "required"}
            </Badge>
            {/* Who is asked, and whether they may refuse. Edited on the live
                version rather than published as a new one: this is not a
                change to anybody's wording. Grades are `grades.sort_order` —
                Stage 1 is 60, and everything below it is pre-school. */}
            <ActionForm action={updateAgreementScope} label="Save scope" size="xs" variant="outline" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="key" value={t.key} />
              <label className="text-xs text-muted-foreground">from grade
                <Input name="gradeSortMin" defaultValue={t.grade_sort_min ?? ""} inputMode="numeric" placeholder="any" className="ml-1 h-7 w-16" />
              </label>
              <label className="text-xs text-muted-foreground">to
                <Input name="gradeSortMax" defaultValue={t.grade_sort_max ?? ""} inputMode="numeric" placeholder="any" className="ml-1 h-7 w-16" />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" name="mayDecline" value="1" defaultChecked={t.may_decline} /> may refuse
              </label>
            </ActionForm>
            <ActionForm action={retireAgreement} label="Retire" size="xs" variant="ghost" confirm="Retire this agreement? New families will no longer be asked to sign it."><input type="hidden" name="key" value={t.key} /></ActionForm>
          </li>
        ))}
        {!templates?.length ? <li className="px-4 py-3 text-sm text-muted-foreground">No active agreements: registration asks for none.</li> : null}
      </ul>
      <section className="surface p-4">
        <h2 className="mb-2 text-sm font-semibold">New agreement</h2>
        <ActionForm action={publishAgreement} label="Publish" size="sm" className="grid gap-2">
          <div className="grid gap-2 md:grid-cols-3">
            <Input name="key" placeholder="key, e.g. transport_policy" pattern="[a-z0-9_]+" required />
            <Input name="name" placeholder="Name shown to parents" required />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" value="1" defaultChecked /> Required to enrol</label>
          </div>
          <Input name="description" placeholder="Description (for staff)" />
          <Input name="documentUrl" type="url" placeholder="Link to the published document (https://…pdf), optional" />
          <Textarea name="bodyHtml" rows={8} placeholder="<h2>Title</h2><p>Wording…</p>" className="font-mono text-xs" required />
        </ActionForm>
      </section>
    </>
  );
}
