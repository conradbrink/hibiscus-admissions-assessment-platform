"use client";

import { useActionState, useMemo, useState } from "react";
import type { StaffActionState } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { placeholderCount, renderPreview, sanitiseParam } from "@/lib/messaging/meta-payload";

/** Sample values so the preview reads like a real message. Same as the email editor's. */
const SAMPLE: Record<string, string> = {
  parent_first_name: "Sarah",
  parent_last_name: "Smith",
  student_first_name: "John",
  student_last_name: "Smith",
  campus: "Block 7",
  grade: "Stage 4",
  application_reference: "HBS-2026-00482",
  location: "Computer lab",
  assessment_date: "Saturday 12 September 2026",
  assessment_time: "09:00",
  offer_expiry_date: "26 September 2026",
  amount_due: "P 5,000.00",
  payment_due_date: "Friday 25 September 2026",
  bank_details: "Hibiscus International Schools (Pty) Ltd\nFirst National Bank Botswana\nAccount 62012345678",
  amount_paid: "P 7,500.00",
  payment_reference: "HBS-2026-00482-3F2A9C1B",
  payment_date: "Monday 14 September 2026",
  missing_documents: "Birth certificate, Latest school report",
  mismatch_details: "Date of birth: the birth certificate shows 15 April 2017; the form says 14 April 2017",
  start_date: "Monday 11 January 2027",
};

const LINK_PURPOSES = ["next_step", "results", "offer", "payment", "registration"] as const;

/** Twilio's Content Template SIDs are `HX` and thirty-two hex characters. */
export const TWILIO_CONTENT_SID = /^HX[0-9a-fA-F]{32}$/;

/** Problems the server will also refuse; shown live so the save button is honest. */
export function templateProblems(input: {
  parameters: string[];
  bodyPreview: string;
  allowed: string[];
  metaName: string;
  twilioContentSid?: string;
  zavuTemplateId?: string;
  active: boolean;
}): string[] {
  const problems: string[] = [];
  const unknown = input.parameters.filter((p) => !input.allowed.includes(p));
  if (unknown.length) problems.push(`Not an allowed variable for this email: ${unknown.join(", ")}`);
  const links = input.parameters.filter((p) => p.endsWith("_link"));
  if (links.length) problems.push(`Links go on the button, not in the text: ${links.join(", ")}`);
  const n = placeholderCount(input.bodyPreview);
  if (n !== input.parameters.length) problems.push(`The wording has ${n} placeholder(s) but ${input.parameters.length} variable(s) are listed`);
  const sid = (input.twilioContentSid ?? "").trim();
  if (input.metaName && !/^[a-z0-9_]+$/.test(input.metaName)) {
    problems.push("A Meta template name is lower-case letters, digits and underscores");
  }
  if (sid && !TWILIO_CONTENT_SID.test(sid)) {
    problems.push("A Twilio content SID starts HX and has thirty-two more characters");
  }
  // Either identifier will do: whichever provider is delivering reads its
  // own, and a school moving between them keeps both for a while.
  if (input.active && !input.metaName && !sid && !(input.zavuTemplateId ?? "").trim()) {
    problems.push("An active template needs an id from whichever provider is sending: Zavu, Twilio or Meta");
  }
  return problems;
}

export function MessageTemplateEditor({
  template,
  allowedVariables,
  action,
}: {
  template: {
    key: string;
    name: string;
    meta_template_name: string | null;
    twilio_content_sid: string | null;
    zavu_template_id: string | null;
    language: string;
    body_preview: string;
    parameters: string[];
    button_link: boolean;
    link_purpose: string;
    is_active: boolean;
  };
  allowedVariables: string[];
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [metaName, setMetaName] = useState(template.meta_template_name ?? "");
  const [twilioContentSid, setTwilioContentSid] = useState(template.twilio_content_sid ?? "");
  const [zavuTemplateId, setZavuTemplateId] = useState(template.zavu_template_id ?? "");
  const [body, setBody] = useState(template.body_preview);
  const [params, setParams] = useState(template.parameters.join("\n"));
  const [active, setActive] = useState(template.is_active);
  const [button, setButton] = useState(template.button_link);

  const parameters = useMemo(() => params.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean), [params]);
  const allowed = useMemo(() => allowedVariables.filter((v) => !v.endsWith("_link")), [allowedVariables]);
  const problems = useMemo(
    () => templateProblems({ parameters, bodyPreview: body, allowed, metaName, twilioContentSid, zavuTemplateId, active }),
    [parameters, body, allowed, metaName, twilioContentSid, zavuTemplateId, active]
  );
  const preview = useMemo(() => renderPreview(body, parameters.map((p) => sanitiseParam(SAMPLE[p] ?? `[${p}]`))), [body, parameters]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="key" value={template.key} />
        <input type="hidden" name="parameters" value={parameters.join(",")} />
        <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={template.name} required /></div>
        <div className="space-y-1">
          <Label htmlFor="metaTemplateName">Meta template name</Label>
          <Input id="metaTemplateName" name="metaTemplateName" value={metaName} onChange={(e) => setMetaName(e.target.value)} placeholder="booking_confirmed_v1" />
          <p className="text-xs text-muted-foreground">Exactly as approved in Meta Business Manager. The approved template must have the same number of body parameters{button ? " and one dynamic-URL button" : ""}.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="zavuTemplateId">Zavu template id</Label>
          <Input
            id="zavuTemplateId"
            name="zavuTemplateId"
            value={zavuTemplateId}
            onChange={(e) => setZavuTemplateId(e.target.value)}
            placeholder="From the Zavu console"
          />
          <p className="text-xs text-muted-foreground">
            The template&rsquo;s id in Zavu, if Zavu is delivering. Its variables are numbered, so the order of the
            variables below is the order they fill&nbsp;
            {button ? "— and the link token fills the button's own first variable" : "the wording"}.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="twilioContentSid">Twilio content SID</Label>
          <Input
            id="twilioContentSid"
            name="twilioContentSid"
            value={twilioContentSid}
            onChange={(e) => setTwilioContentSid(e.target.value)}
            placeholder="HX0123456789abcdef0123456789abcdef"
          />
          <p className="text-xs text-muted-foreground">
            From the Twilio console, if Twilio is delivering. Twilio addresses a template by this SID rather than by name, and
            its variables are numbered in one flat list{button ? " — the link token is the one after the body's" : ""}.
          </p>
        </div>
        <div className="space-y-1"><Label htmlFor="language">Language code</Label><Input id="language" name="language" defaultValue={template.language} pattern="[a-z]{2}(_[A-Z]{2})?" required className="w-32" /></div>
        <div className="space-y-1">
          <Label htmlFor="bodyPreview">Approved wording</Label>
          <Textarea id="bodyPreview" name="bodyPreview" rows={5} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" required />
          <p className="text-xs text-muted-foreground">Paste the wording Meta approved, with <code className="rounded bg-muted px-1">{"{{1}}"}</code>, <code className="rounded bg-muted px-1">{"{{2}}"}</code>… where the values go. Used for the preview and the record; the message itself is Meta&rsquo;s copy.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="params">Variables, one per line, in order</Label>
          <Textarea id="params" rows={4} value={params} onChange={(e) => setParams(e.target.value)} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">Allowed: {allowed.map((v) => <code key={v} className="mr-1 rounded bg-muted px-1">{v}</code>)}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="buttonLink" value="1" checked={button} onChange={(e) => setButton(e.target.checked)} className="size-4 accent-primary" />
          The template has a button that opens the parent&rsquo;s link
        </label>
        {button ? (
          <div className="space-y-1">
            <Label htmlFor="linkPurpose">Which link the button opens</Label>
            <NativeSelect id="linkPurpose" name="linkPurpose" defaultValue={template.link_purpose} className="w-56">
              {LINK_PURPOSES.map((p) => <option key={p} value={p}>{p.replace("_", " ")}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">In Meta, the button&rsquo;s URL must be <code className="rounded bg-muted px-1">{"<site>/a/{{1}}"}</code>; the token fills the variable.</p>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" value="1" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-primary" />
          Active: send this beside the email when WhatsApp is on
        </label>
        {problems.length ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {problems.map((p) => <span key={p} className="block">{p}</span>)}
          </p>
        ) : null}
        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        {state.ok ? <p className="text-xs text-success">Saved.</p> : null}
        <Button type="submit" disabled={pending || problems.length > 0}>Save</Button>
      </form>
      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Preview with sample values</p>
        <div className="max-w-sm rounded-2xl rounded-tl-sm bg-success/15 px-4 py-3 text-sm whitespace-pre-wrap">
          {preview || <span className="text-muted-foreground">Nothing yet.</span>}
          {button ? <span className="mt-2 block border-t border-border pt-2 text-center font-medium text-primary">Open</span> : null}
        </div>
      </div>
    </div>
  );
}
