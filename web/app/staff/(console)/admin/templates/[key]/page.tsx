import { notFound } from "next/navigation";
import { PageTitle } from "@/components/staff/page-title";
import { TemplateEditor } from "@/components/staff/template-editor";
import { requireStaff } from "@/lib/staff/session";
import { publishTemplate } from "../actions";

export default async function TemplateEditPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { supabase } = await requireStaff("templates.write");
  const { data: template } = await supabase
    .from("email_templates")
    .select("*")
    .eq("key", key)
    .eq("is_active", true)
    .maybeSingle();
  if (!template) notFound();

  return (
    <>
      <PageTitle title={template.name} description={`${template.key} · version ${template.version}`} />
      <TemplateEditor template={template} action={publishTemplate} />
    </>
  );
}
