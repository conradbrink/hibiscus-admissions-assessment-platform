"use client";

import { useActionState, useMemo, useState } from "react";
import type { StaffActionState } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { renderHtml, validateTemplate, type TemplateVariables } from "@/lib/email/render";

const SAMPLE: TemplateVariables = {
  parent_first_name: "Sarah",
  parent_last_name: "Smith",
  student_first_name: "John",
  student_last_name: "Smith",
  campus: "Block 7",
  grade: "Stage 4",
  intake: "Term 1, 2027",
  start_date: "Monday 11 January 2027",
  offer_expiry_date: "26 September 2026",
  application_reference: "HBS-2026-00482",
  registration_fee: "P 2,500.00",
  admission_fee: "P 5,000.00",
  tuition_annual: "P 48,000.00",
  tuition_term: null,
  amount_due: "P 7,500.00",
  currency: "BWP",
  conditions: null,
};

export function OfferTemplateEditor({
  template,
  action,
}: {
  template: { key: string; name: string; description: string | null; body_html: string; terms_html: string; allowed_variables: string[]; version: number };
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [body, setBody] = useState(template.body_html);
  const [terms, setTerms] = useState(template.terms_html);
  const problems = useMemo(
    () => [...validateTemplate(body, template.allowed_variables), ...validateTemplate(terms, template.allowed_variables)],
    [body, terms, template.allowed_variables]
  );
  const preview = useMemo(() => {
    if (problems.length) return null;
    try {
      return renderHtml(body, SAMPLE, template.allowed_variables) + renderHtml(terms, SAMPLE, template.allowed_variables);
    } catch {
      return null;
    }
  }, [body, terms, problems.length, template.allowed_variables]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="key" value={template.key} />
        <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={template.name} required /></div>
        <div className="space-y-1"><Label htmlFor="description">Description</Label><Input id="description" name="description" defaultValue={template.description ?? ""} /></div>
        <div className="space-y-1"><Label htmlFor="bodyHtml">Offer body (HTML)</Label><Textarea id="bodyHtml" name="bodyHtml" rows={16} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" required /></div>
        <div className="space-y-1"><Label htmlFor="termsHtml">Terms (HTML)</Label><Textarea id="termsHtml" name="termsHtml" rows={8} value={terms} onChange={(e) => setTerms(e.target.value)} className="font-mono text-xs" required /></div>
        <p className="text-xs text-muted-foreground">
          Allowed variables: {template.allowed_variables.map((v) => <code key={v} className="mr-1 rounded bg-muted px-1">{`{{${v}}}`}</code>)}
        </p>
        {problems.length ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {problems.map((p, i) => <span key={i} className="block">{p.kind === "unknown_variable" ? `Unknown variable {{${p.name}}}` : "An {{#if}} is not closed"}</span>)}
          </p>
        ) : null}
        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        {state.ok ? <p className="text-xs text-success">Published as version {template.version + 1}.</p> : null}
        <Button type="submit" disabled={pending || problems.length > 0}>Publish new version</Button>
      </form>
      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Preview with sample values</p>
        {preview ? (
          <div className="prose prose-sm max-w-none rounded-xl border border-border bg-white p-6 text-black" dangerouslySetInnerHTML={{ __html: preview }} />
        ) : (
          <p className="text-sm text-muted-foreground">Fix the problems on the left to see a preview.</p>
        )}
      </div>
    </div>
  );
}
