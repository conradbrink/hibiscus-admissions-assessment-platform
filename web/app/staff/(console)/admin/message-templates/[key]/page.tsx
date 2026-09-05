import { notFound } from "next/navigation";
import { MessageTemplateEditor } from "@/components/staff/message-template-editor";
import { PageTitle } from "@/components/staff/page-title";
import { requireStaff } from "@/lib/staff/session";
import { saveMessageTemplate } from "../actions";

export default async function MessageTemplateEditPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { supabase } = await requireStaff("templates.write");
  const [{ data: template }, { data: email }] = await Promise.all([
    supabase.from("message_templates").select("*").eq("key", key).maybeSingle(),
    supabase.from("email_templates").select("name, allowed_variables").eq("key", key).eq("is_active", true).maybeSingle(),
  ]);
  if (!template) notFound();

  return (
    <>
      <PageTitle title={template.name} description={`Beside the email “${email?.name ?? key}” · ${key}`} />
      <MessageTemplateEditor template={template} allowedVariables={email?.allowed_variables ?? []} action={saveMessageTemplate} />
    </>
  );
}
