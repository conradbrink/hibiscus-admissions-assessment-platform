#!/usr/bin/env node
// The WhatsApp templates, from web/content/messaging/zavu-templates.json to
// Zavu and back again.
//
//   node web/scripts/zavu-templates.mjs                     # the form fields, to paste into the dashboard
//   node web/scripts/zavu-templates.mjs --only offer_reminder
//   node web/scripts/zavu-templates.mjs --api --only booking_confirmed
//   node web/scripts/zavu-templates.mjs --sql booking_confirmed=ks74n7yj...
//
// The bodies here are the ones Meta approves and the ones our
// message_templates rows preview. Their parameters are positional: the send
// fills {{1}}..{{n}} in the order listed, so re-wording a template is free
// and re-ordering its parameters is not.
//
// --api is a convenience, not the documented path. Zavu's published client
// creates a template with name/language/body and says nothing about buttons,
// so the buttons field below is inferred from what their dashboard sends to
// Meta. Try it on one template before trusting it with twelve; when it is
// refused the response is printed in full, which is how we learn the real
// shape. The dashboard form always works.
//
// Reads ZAVU_API_KEY and ZAVU_SENDER_ID from the environment. Never put
// either in a file in this repository.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(here, "..", "content", "messaging", "zavu-templates.json"), "utf8"));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

// Validate before doing anything, so a mistyped template fails here rather
// than in front of Meta's reviewer.
for (const t of doc.templates) {
  const highest = Math.max(0, ...[...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  if (highest !== t.parameters.length) {
    throw new Error(`${t.key}: the body goes up to {{${highest}}} but ${t.parameters.length} parameters are listed`);
  }
  if (t.samples.length !== t.parameters.length) {
    throw new Error(`${t.key}: ${t.samples.length} samples for ${t.parameters.length} parameters`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(t.key)) throw new Error(`${t.key}: Meta wants lowercase with underscores`);
  if (t.body.length > 1024) throw new Error(`${t.key}: body is ${t.body.length} characters, Meta allows 1024`);
  if (t.button && t.button.length > 25) throw new Error(`${t.key}: button text is longer than 25 characters`);
}

const only = value("only");
const chosen = only ? doc.templates.filter((t) => t.key === only) : doc.templates;
if (only && chosen.length === 0) throw new Error(`no template called "${only}"`);

if (flag("sql")) {
  // Record the ids Zavu handed back, and switch the templates on. Written as
  // one statement per template so a mistyped id fails on its own row.
  const pairs = argv.filter((a) => a.includes("=") && !a.startsWith("--"));
  if (pairs.length === 0) throw new Error("pass at least one key=id pair");
  for (const pair of pairs) {
    const [key, id] = pair.split("=");
    if (!doc.templates.some((t) => t.key === key)) throw new Error(`no template called "${key}"`);
    if (!id) throw new Error(`${key}: no id`);
    // Validated, not escaped. This line prints SQL that somebody pastes into
    // the production SQL editor, so the id has to be beyond suspicion rather
    // than quoted correctly: a Zavu template id is alphanumeric with dashes
    // and underscores, and anything else is a typo or a paste that went wrong.
    // The key is already known to be one of ours from the check above.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new Error(`${key}: "${id}" is not a template id (letters, digits, dash, underscore; up to 64)`);
    }
    // This script's whole job is to emit SQL text for a person to read and
    // paste; both values it interpolates are validated against a fixed shape
    // immediately above, which is why the rule is suppressed here and only
    // here.
    // nosemgrep: sql-built-by-string-interpolation
    console.log(`update message_templates set zavu_template_id = '${id}', is_active = true, updated_at = now() where key = '${key}';`);
  }
  process.exit(0);
}

const apiBody = (t) => ({
  name: t.key,
  language: doc.language,
  body: t.body,
  whatsappCategory: doc.category,
  ...(t.button
    ? { buttons: [{ type: "url", text: t.button, url: doc.buttonUrl, example: doc.buttonExample }] }
    : {}),
});

if (flag("api")) {
  const key = process.env.ZAVU_API_KEY;
  const sender = process.env.ZAVU_SENDER_ID;
  if (!key) throw new Error("ZAVU_API_KEY is not set");
  const base = (process.env.ZAVU_API_URL ?? "https://api.zavu.dev").replace(/\/$/, "");
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(sender ? { "Zavu-Sender": sender } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}\n${text}`);
    return text ? JSON.parse(text) : {};
  };

  for (const t of chosen) {
    const created = await call("POST", "/v1/templates", apiBody(t));
    const id = created?.data?.id ?? created?.template?.id ?? created?.id;
    if (!id) throw new Error(`${t.key}: created, but no id in the response\n${JSON.stringify(created)}`);
    if (sender) await call("POST", `/v1/templates/${id}/submit`, { senderId: sender, category: doc.category });
    console.log(`${t.key}=${id}${sender ? " (submitted)" : " (draft, submit it from the dashboard)"}`);
  }
  console.error(`\nDone. Record them:\n  node web/scripts/zavu-templates.mjs --sql <key>=<id> ...`);
  process.exit(0);
}

// The dashboard form, field by field.
for (const t of chosen) {
  console.log(`\n${"─".repeat(72)}\n${t.key}\n${"─".repeat(72)}`);
  console.log(`Name       ${t.key}`);
  console.log(`Category   ${doc.category}`);
  console.log(`Language   ${doc.language}`);
  console.log(`Header     None`);
  console.log(`Footer     (leave blank)`);
  console.log(`\nBody\n${t.body}`);
  console.log(`\nSamples`);
  t.parameters.forEach((p, i) => console.log(`  {{${i + 1}}}  ${t.samples[i]}   (${p})`));
  if (t.button) {
    console.log(`\nButton 1`);
    console.log(`  Type      URL`);
    console.log(`  Text      ${t.button}`);
    console.log(`  URL       ${doc.buttonUrl}`);
    console.log(`  Example   ${doc.buttonExample}`);
  } else {
    console.log(`\nButton     none — delete the button row`);
  }
}
console.log(
  `\n${"─".repeat(72)}\nCreate each one, then Submit to WhatsApp. When Meta approves it, copy the id\nfrom the templates list and record it:\n\n  node web/scripts/zavu-templates.mjs --sql booking_confirmed=<id> offer_reminder=<id>\n`
);
