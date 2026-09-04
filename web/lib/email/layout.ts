import { escapeHtml } from "@/lib/email/render";

/**
 * The frame around every email: header, body, footer, and the one button
 * style. Templates supply the body only, so an administrator editing wording
 * cannot break the layout, and a brand change is one edit here.
 *
 * Email clients are inconsistent about <style>, so the button is also
 * rewritten to inline styles after rendering. Colours are literals here
 * because CSS variables do not exist in email.
 */

const BRAND = "#e8632b";
const INK = "#2a231f";
const MUTED = "#6b625c";
const PAPER = "#fbf9f5";

const BUTTON_STYLE = `display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 24px;border-radius:12px;`;

export function wrapHtml(bodyHtml: string, opts: { preheader?: string } = {}): string {
  const body = bodyHtml
    .replace(/<a([^>]*)class="button"([^>]*)>/g, `<a$1style="${BUTTON_STYLE}"$2>`)
    .replace(
      /<table class="details">/g,
      `<table style="border-collapse:collapse;margin:16px 0;font-size:16px;">`
    )
    .replace(/<td>/g, `<td style="padding:6px 16px 6px 0;vertical-align:top;color:${MUTED};">`);

  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hibiscus Schools</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
${preheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.2px;">Hibiscus Schools</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55;">
${body}
</td></tr>
<tr><td style="padding:20px 28px;font-size:13px;line-height:1.5;color:${MUTED};border-top:1px solid #eee7df;">
This email was sent by Hibiscus Schools Admissions. If you did not expect it, you can safely ignore it. Links in this email are personal to you — please do not forward them.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
