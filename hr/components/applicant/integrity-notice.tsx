"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptIntegrityNoticeAction } from "@/app/(applicant)/apply/actions";

/**
 * Said once, plainly, before the questions open: every answer is checked for
 * AI-written text, and a flag means a conversation, not a rejection. The
 * answer boxes stay locked until the applicant has confirmed it.
 */
export function IntegrityNotice({ notice, accepted }: { notice: string; accepted: boolean }) {
  const router = useRouter();
  const [ticked, setTicked] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="integrity-title" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex gap-3">
        <ShieldCheck className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden />
        <div className="space-y-3">
          <h2 id="integrity-title" className="font-semibold">
            Write your answers yourself
          </h2>
          <p className="text-[15px] leading-relaxed">{notice}</p>
          <p className="text-sm text-muted-foreground">
            We mark what your answers show about teaching, not your grammar. Simple English is fine. A person reviews anything the check flags.
          </p>
          {accepted ? (
            <p className="text-sm font-medium text-success">You confirmed this. The questions are open.</p>
          ) : (
            <div className="space-y-3">
              <label className="flex items-start gap-3 text-[15px]">
                <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" />
                I will write every answer myself, without an AI tool.
              </label>
              <Button
                type="button"
                size="lg"
                disabled={!ticked || pending}
                onClick={() =>
                  start(async () => {
                    const r = await acceptIntegrityNoticeAction();
                    if (r.error) setError(r.error);
                    else router.refresh();
                  })
                }
              >
                {pending ? "Opening…" : "Open the questions"}
              </Button>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
