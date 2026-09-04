import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

export default async function OfferTemplatesPage() {
  const { supabase } = await requireStaff("templates.write");
  const { data: templates } = await supabase
    .from("offer_templates")
    .select("key, version, name, description, updated_at")
    .eq("is_active", true)
    .order("key");
  return (
    <>
      <PageTitle title="Offer templates" description="The wording of an offer of admission. Fees, names, dates and the expiry are filled in from the application when the offer is generated. Editing publishes a new version; offers already generated keep the version they were rendered with." />
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {(templates ?? []).map((t) => (
          <li key={t.key} className="px-4 py-3 text-sm">
            <Link href={`/staff/admin/offer-templates/${t.key}`} className="font-medium hover:underline">{t.name}</Link>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{t.key} · v{t.version}</span>
            <p className="text-muted-foreground">{t.description}</p>
            <p className="text-xs text-muted-foreground">Updated {formatDate(t.updated_at)}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
