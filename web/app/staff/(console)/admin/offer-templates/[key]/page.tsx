import { notFound } from "next/navigation";
import { OfferTemplateEditor } from "@/components/staff/offer-template-editor";
import { PageTitle } from "@/components/staff/page-title";
import { requireStaff } from "@/lib/staff/session";
import { publishOfferTemplate } from "../actions";

export default async function OfferTemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { supabase } = await requireStaff("templates.write");
  const { data: template } = await supabase.from("offer_templates").select("*").eq("key", key).eq("is_active", true).maybeSingle();
  if (!template) notFound();
  return (
    <>
      <PageTitle title={template.name} description={`${template.key} · version ${template.version}`} />
      <OfferTemplateEditor template={template} action={publishOfferTemplate} />
    </>
  );
}
