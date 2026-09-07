"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareForUpload } from "@/lib/documents/shrink";
import { uploadErrorText } from "@/lib/documents/upload-errors";

type Phase = { kind: "idle" } | { kind: "preparing" } | { kind: "uploading" } | { kind: "saving" } | { kind: "reading" } | { kind: "done"; filename: string } | { kind: "error"; message: string };

/**
 * Choosing a file is the upload. The bytes go straight from the phone to
 * the school's private bucket (shrunk first if it is a big photo), then the
 * server checks and records them. No second button, nothing lost between
 * "chosen" and "sent". With the reading switched on, a birth certificate is
 * read after the upload and the form refreshes with what it says.
 */
export function DocumentUploader({
  requirement,
  replace,
  variant = "default",
  label,
  waitForReading = false,
}: {
  requirement: string;
  /** A document is already there; the button reads "Replace". */
  replace?: boolean;
  variant?: "default" | "outline";
  label?: string;
  /** Poll until the document has been read, then refresh (the student step). */
  waitForReading?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "preparing" || phase.kind === "uploading" || phase.kind === "saving" || phase.kind === "reading";

  const fail = (code: string) => setPhase({ kind: "error", message: uploadErrorText(code) });

  const onChange = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhase({ kind: "preparing" });
      const prepared = await prepareForUpload(file);
      if (prepared.blob.size === 0) return fail("empty");

      const start = await fetch("/api/register/document/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requirement, size: prepared.blob.size, type: prepared.type }),
      });
      const target = (await start.json().catch(() => null)) as { ok: boolean; code?: string; signedUrl?: string; path?: string } | null;
      if (!start.ok || !target?.ok || !target.signedUrl || !target.path) return fail(target?.code ?? "failed");

      setPhase({ kind: "uploading" });
      const put = await fetch(target.signedUrl, {
        method: "PUT",
        headers: { "content-type": prepared.type || "application/octet-stream", "x-upsert": "false", "cache-control": "max-age=3600" },
        body: prepared.blob,
      });
      if (!put.ok) return fail(put.status === 413 ? "too_large" : "failed");

      setPhase({ kind: "saving" });
      const complete = await fetch("/api/register/document/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requirement, path: target.path, filename: prepared.filename }),
      });
      const result = (await complete.json().catch(() => null)) as { ok: boolean; code?: string; document?: { id: string; filename: string; reading: boolean } } | null;
      if (!complete.ok || !result?.ok || !result.document) return fail(result?.code ?? "failed");

      if (waitForReading && result.document.reading) {
        setPhase({ kind: "reading" });
        const until = Date.now() + 75_000;
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, 2500));
          const res = await fetch(`/api/register/document/reading?id=${result.document.id}`, { cache: "no-store" });
          const j = (await res.json().catch(() => null)) as { status?: string } | null;
          if (j?.status === "done" || j?.status === "failed") break;
        }
      }
      setPhase({ kind: "done", filename: result.document.filename });
      router.refresh();
    } catch {
      fail("failed");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const text =
    phase.kind === "preparing" ? "Preparing…" :
    phase.kind === "uploading" ? "Uploading…" :
    phase.kind === "saving" ? "Saving…" :
    phase.kind === "reading" ? "Reading the document…" :
    label ?? (replace ? "Replace" : "Upload");

  return (
    <div className="mt-3 space-y-2">
      <input
        ref={input}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
        className="sr-only"
        onChange={(e) => void onChange(e.target.files?.[0])}
        disabled={busy}
        aria-label={label ?? `Choose a file for ${requirement.replace(/_/g, " ")}`}
      />
      <Button type="button" variant={replace ? "outline" : variant} size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Upload data-icon="inline-start" />} {text}
      </Button>
      {phase.kind === "done" ? (
        <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden /> {phase.filename} uploaded.</p>
      ) : null}
      {phase.kind === "reading" ? <p className="text-xs text-muted-foreground">This usually takes a few seconds. You can keep typing; the form fills in the rest when it is done.</p> : null}
      {phase.kind === "error" ? <p role="alert" className="text-sm text-destructive">{phase.message}</p> : null}
      <noscript>
        <form method="post" action="/api/register/document" encType="multipart/form-data" className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="hidden" name="requirement" value={requirement} />
          <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required className="text-sm" />
          <Button type="submit" size="sm">Upload</Button>
        </form>
      </noscript>
    </div>
  );
}
