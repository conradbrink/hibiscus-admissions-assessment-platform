"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeDocumentAction } from "@/app/(applicant)/apply/actions";

export type UploadedDoc = { id: string; kind: string; file_name: string; size_bytes: number };

const MESSAGES: Record<string, string> = {
  too_large: "That file is bigger than 10 MB. Try a smaller scan or a photo.",
  bad_type: "We can only take a PDF, a JPG or a PNG.",
  empty: "That file looks empty. Please choose it again.",
  too_many: "You have uploaded the most files we can take. Remove one first.",
  session: "Your session has ended. Open the link in your email to continue.",
  busy: "You are uploading very quickly. Wait a moment and try again.",
  failed: "The upload did not work. Check your connection and try again.",
};

/**
 * One upload slot per kind of document. The file goes straight to storage
 * through a signed address, then the server checks what it really is. A
 * phone's camera counts: `accept` lets the applicant photograph a certificate.
 */
export function DocumentUploader({ kind, label, hint, documents }: { kind: string; label: string; hint: string; documents: UploadedDoc[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  const mine = documents.filter((d) => d.kind === kind);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) return setError(MESSAGES.too_large);
    setPhase("uploading");
    try {
      const start = await fetch("/api/apply/document/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size: file.size }) });
      const target = (await start.json().catch(() => null)) as { ok: boolean; code?: string; signedUrl?: string; path?: string } | null;
      if (!start.ok || !target?.ok || !target.signedUrl || !target.path) throw new Error(target?.code ?? "failed");
      const put = await fetch(target.signedUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file });
      if (!put.ok) throw new Error(put.status === 413 ? "too_large" : "failed");
      const done = await fetch("/api/apply/document/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, path: target.path, filename: file.name }),
      });
      const result = (await done.json().catch(() => null)) as { ok: boolean; code?: string } | null;
      if (!done.ok || !result?.ok) throw new Error(result?.code ?? "failed");
      router.refresh();
    } catch (e) {
      setError(MESSAGES[(e as Error).message] ?? MESSAGES.failed);
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-input bg-background px-4 text-sm font-medium hover:border-foreground/40 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40">
          {phase === "uploading" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {phase === "uploading" ? "Uploading…" : mine.length ? "Add another" : "Choose a file"}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            disabled={phase === "uploading"}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {mine.length ? (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {mine.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{d.file_name}</span>
              <span className="text-muted-foreground tabular-nums">{Math.max(1, Math.round(d.size_bytes / 1024))} KB</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={removing}
                aria-label={`Remove ${d.file_name}`}
                onClick={() =>
                  startRemove(async () => {
                    const r = await removeDocumentAction(d.id);
                    if (r.error) setError(r.error);
                    router.refresh();
                  })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
