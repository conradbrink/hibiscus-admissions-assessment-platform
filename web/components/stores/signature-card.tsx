import { formatDateTime } from "@/lib/format-date";
import { asDrawing, drawingDataUrl } from "@/lib/stores/signature";
import type { Json } from "@/lib/supabase/types";

/**
 * A stored signature, as the employee drew it, with the words they signed
 * and when. The picture is rebuilt from the stored numbers and shown as an
 * image, never as markup, and only to somebody who may read Stores: there is
 * no address for it outside this page.
 */
export function SignatureCard({
  title,
  signature,
}: {
  title: string;
  signature: { employee_name: string; drawing: Json; acknowledgement: string; signed_at: string; recorded_by_name: string; summary_hash: string };
}) {
  const drawing = asDrawing(signature.drawing);
  return (
    <section className="surface p-4" aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="rounded-xl border border-border bg-white p-2">
        {drawing ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL built on the server from the stored strokes
          <img src={drawingDataUrl(drawing)} alt={`Signature of ${signature.employee_name}`} className="mx-auto max-h-48 w-full object-contain" />
        ) : (
          <p className="p-4 text-center text-sm text-destructive">The stored signature could not be read.</p>
        )}
      </div>
      <p className="mt-2 text-sm"><span className="font-medium">{signature.employee_name}</span> <span className="text-muted-foreground">signed {formatDateTime(signature.signed_at)}</span></p>
      <p className="mt-1 text-xs text-muted-foreground">Witnessed and recorded by {signature.recorded_by_name}</p>
      <blockquote className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">“{signature.acknowledgement}”</blockquote>
      <p className="mt-2 font-mono text-[10.5px] break-all text-muted-foreground" title="SHA-256 of what was on the screen when the employee signed">Record fingerprint {signature.summary_hash.slice(0, 32)}</p>
    </section>
  );
}
