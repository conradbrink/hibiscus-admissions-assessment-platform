"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normaliseMobile } from "@/lib/contacts";

type Match = { family_id: string; family_code: string; display_name: string | null; campus_name: string | null; reason: string; contact_name: string; contact_email: string };

/**
 * "Possible existing family found", while the person is still typing.
 *
 * Asks `crm_find_duplicates` (security invoker: only families this person
 * may see) as soon as an email, a number or a full parent name is in the
 * form, and shows what it found beside the form with the three answers the
 * brief asks for: use the existing one, merge later, or create anyway.
 * The server action runs the same check, so a stale page cannot slip past.
 */
export function DuplicateCheck({ formId }: { formId: string }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      const fd = new FormData(form);
      const email = String(fd.get("email") ?? "").trim();
      const mobile = normaliseMobile(String(fd.get("mobile") ?? ""));
      const last = String(fd.get("lastName") ?? "").trim();
      const first = String(fd.get("firstName") ?? "").trim();
      if (!email && !mobile && !(last && first)) {
        setMatches([]);
        setChecked(false);
        return;
      }
      const { data } = await createClient().rpc("crm_find_duplicates", {
        p_email: email || null,
        p_mobile_normalised: mobile,
        p_last_name: last || null,
        p_first_name: first || null,
      });
      setMatches((data ?? []) as Match[]);
      setChecked(true);
    };
    const onInput = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 500);
    };
    form.addEventListener("input", onInput);
    return () => {
      form.removeEventListener("input", onInput);
      if (timer) clearTimeout(timer);
    };
  }, [formId]);

  if (!checked) return null;
  if (matches.length === 0) return <p className="text-xs text-success">No existing family matches what has been typed so far.</p>;
  return (
    <div className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
      <p className="font-semibold">Possible existing family found</p>
      <ul className="mt-1 space-y-1">
        {matches.map((m) => (
          <li key={m.family_id} className="flex flex-wrap items-center gap-2">
            <span>
              <Link href={`/staff/crm/families/${m.family_id}`} className="font-medium underline">{m.display_name ?? m.family_code} family</Link>
              <span className="text-muted-foreground"> · {m.reason.toLowerCase()} · {m.contact_name}{m.campus_name ? ` · ${m.campus_name}` : ""}</span>
            </span>
            <Link href={`/staff/crm/families/${m.family_id}`} className="rounded-full border border-border bg-card px-2 py-0.5 text-xs hover:bg-muted">Use existing</Link>
            <Link href={`/staff/crm/families/${m.family_id}?merge=1`} className="rounded-full border border-border bg-card px-2 py-0.5 text-xs hover:bg-muted">Merge later</Link>
          </li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input type="checkbox" name="createAnyway" value="1" form={formId} /> This is a different family. Create it anyway.
      </label>
    </div>
  );
}
