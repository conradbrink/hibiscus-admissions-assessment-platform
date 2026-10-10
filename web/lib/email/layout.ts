import { escapeHtml } from "@/lib/email/render";

/**
 * Where the logo lives. Read from the public site URL directly rather than
 * through lib/tokens, which is server-only, because the template editor
 * (a client component) previews emails with this same frame.
 */
function logoUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
}

/**
 * The frame around every email: header, body, footer, and the one button
 * style. Templates supply the body only, so an administrator editing wording
 * cannot break the layout, and a brand change is one edit here.
 *
 * Email clients are inconsistent about <style>, so the button, the details
 * table and any bare heading are also rewritten to inline styles after
 * rendering. Colours are literals here because CSS variables do not exist in
 * email.
 *
 * The look is the school website's (hibiscusschools.com): bottle green for
 * the one action, navy headings, grey body copy on a light grey page, and
 * the website's pill button. Open Sans and Poppins are named first for the
 * clients that have them; everyone else gets Arial, and nothing in the
 * layout depends on which. Outlook ignores the rounded corners and draws
 * square ones, which is all it loses.
 */

const BRAND = "#006a4e";
const NAVY = "#172033";
const INK = "#374151";
const MUTED = "#6b7280";
const PAPER = "#f6f8fb";
const LINE = "#e3e8ef";

const FONT = "'Open Sans',Arial,Helvetica,sans-serif";
const HEAD_FONT = "'Poppins','Open Sans',Arial,Helvetica,sans-serif";

const BUTTON_STYLE = `display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-family:${HEAD_FONT};font-weight:600;font-size:16px;line-height:1.2;padding:15px 26px;border-radius:999px;`;

const HEADING_STYLE: Record<string, string> = {
  h1: `margin:0 0 12px;font-family:${HEAD_FONT};font-size:24px;line-height:1.15;font-weight:800;color:${NAVY};`,
  h2: `margin:20px 0 8px;font-family:${HEAD_FONT};font-size:20px;line-height:1.2;font-weight:700;color:${NAVY};`,
  h3: `margin:16px 0 6px;font-family:${HEAD_FONT};font-size:17px;line-height:1.3;font-weight:600;color:${NAVY};`,
};

export function wrapHtml(bodyHtml: string, opts: { preheader?: string } = {}): string {
  const body = bodyHtml
    .replace(/<a([^>]*)class="button"([^>]*)>/g, `<a$1style="${BUTTON_STYLE}"$2>`)
    .replace(
      /<table class="details">/g,
      `<table style="border-collapse:collapse;margin:16px 0;font-size:16px;">`
    )
    .replace(/<td>/g, `<td style="padding:6px 16px 6px 0;vertical-align:top;color:${MUTED};">`)
    // Only a bare tag: a heading the author styled keeps its own style.
    .replace(/<(h[123])>/g, (_, tag: string) => `<${tag} style="${HEADING_STYLE[tag]}">`);

  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hibiscus International Schools</title>
<style>a{color:${BRAND};}</style>
</head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${FONT};color:${INK};">
${preheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:24px;overflow:hidden;">
<tr><td style="padding:22px 28px 16px;border-bottom:3px solid ${BRAND};"><img src="${logoUrl()}/brand/hibiscus-logo.png" width="150" height="68" alt="Hibiscus International Schools" style="display:block;width:150px;height:auto;border:0;"></td></tr>
<tr><td style="padding:28px;font-family:${FONT};font-size:16px;line-height:1.65;color:${INK};">
${body}
</td></tr>
<tr><td style="padding:20px 28px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};border-top:1px solid ${LINE};background:${PAPER};">
This email was sent by Hibiscus International Schools Admissions. If you did not expect it, you can safely ignore it. Links in this email are personal to you — please do not forward them.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
