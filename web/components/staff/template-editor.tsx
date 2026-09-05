"use client";

import { useActionState, useMemo, useState } from "react";
import type { StaffActionState } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { wrapHtml } from "@/lib/email/layout";
import { renderHtml, renderSubject, validateTemplate, type TemplateVariables } from "@/lib/email/render";

/** Sample values so the preview reads like a real email. */
const SAMPLE: TemplateVariables = {
  parent_first_name: "Sarah",
  parent_last_name: "Smith",
  student_first_name: "John",
  student_last_name: "Smith",
  campus: "Block 7",
  grade: "Stage 4",
  application_reference: "HBS-2026-00482",
  next_step_link: "https://example.invalid/a/sample",
  location: "Computer lab",
  assessment_date: "Saturday 12 September 2026",
  assessment_time: "09:00",
  offer_expiry_date: "26 September 2026",
  amount_due: "P 5,000",
  payment_link: "https://example.invalid/pay",
  results_link: "https://example.invalid/profile",
  offer_link: "https://example.invalid/offer",
};

export function TemplateEditor({
  template,
  action,
}: {
  template: {
    key: string;
    name: string;
    description: string | null;
    subject: string;
    body_html: string;
    body_text: string;
    allowed_variables: string[];
    version: number;
  };
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [subject, setSubject] = useState(template.subject);
  const [html, setHtml] = useState(template.body_html);
  const [text, setText] = useState(template.body_text);

  const problems = useMemo(
    () => [
      ...validateTemplate(subject, template.allowed_variables),
      ...validateTemplate(html, template.allowed_variables),
      ...validateTemplate(text, template.allowed_variables),
    ],
    [subject, html, text, template.allowed_variables]
  );
  const preview = useMemo(() => {
    if (problems.length) return null;
    try {
      return {
        subject: renderSubject(subject, SAMPLE, template.allowed_variables),
        html: wrapHtml(renderHtml(html, SAMPLE, template.allowed_variables)),
      };
    } catch {
      return null;
    }
  }, [subject, html, problems.length, template.allowed_variables]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="key" value={template.key} />
        <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={template.name} required /></div>
        <div className="space-y-1"><Label htmlFor="description">When it is sent</Label><Input id="description" name="description" defaultValue={template.description ?? ""} /></div>
        <div className="space-y-1"><Label htmlFor="subject">Subject</Label><Input id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="bodyHtml">HTML body</Label><Textarea id="bodyHtml" name="bodyHtml" rows={14} value={html} onChange={(e) => setHtml(e.target.value)} className="font-mono text-xs" required /></div>
        <div className="space-y-1"><Label htmlFor="bodyText">Plain-text body</Label><Textarea id="bodyText" name="bodyText" rows={10} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" required /></div>
        <p className="text-xs text-muted-foreground">
          Allowed variables: {template.allowed_variables.map((v) => <code key={v} className="mr-1 rounded bg-muted px-1">{`{{${v}}}`}</code>)}
          <br />Conditional: <code className="rounded bg-muted px-1">{"{{#if location}}…{{/if}}"}</code>. Use <code className="rounded bg-muted px-1">class=&quot;button&quot;</code> on a link for the big button.
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
          <>
            <p className="mb-2 rounded-md bg-muted px-3 py-2 text-sm"><span className="text-muted-foreground">Subject:</span> {preview.subject}</p>
            <iframe title="Preview" srcDoc={preview.html} sandbox="" className="h-[640px] w-full rounded-xl border border-border bg-white" />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Fix the problems on the left to see a preview.</p>
        )}
      </div>
    </div>
  );
}
