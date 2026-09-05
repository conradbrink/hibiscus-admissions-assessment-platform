import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";
import type { Comparison } from "@/lib/documents/compare";
import type { DocumentRow, Json } from "@/lib/supabase/types";

/**
 * What the extractor read from one document, beside what the form says.
 * A reading is a proposal: the badges say "same" or "differs", and nothing
 * on this panel changes a registration field.
 */
export function DocumentReading({ document }: { document: Pick<DocumentRow, "extraction_status" | "extracted_fields" | "extraction_error" | "extraction_model" | "extracted_at"> }) {
  if (document.extraction_status === "not_run") return null;
  if (document.extraction_status === "pending") return <p className="mt-1 text-xs text-muted-foreground">Reading the document…</p>;
  if (document.extraction_status === "failed") return <p className="mt-1 text-xs text-muted-foreground">Could not read the document{document.extraction_error ? `: ${document.extraction_error}` : ""}.</p>;

  const fields = (document.extracted_fields && typeof document.extracted_fields === "object" && !Array.isArray(document.extracted_fields) ? document.extracted_fields : {}) as Record<string, Json>;
  const comparisons = (Array.isArray(fields.comparisons) ? fields.comparisons : []) as unknown as Comparison[];
  const confidence = typeof fields.confidence === "number" ? Math.round(fields.confidence * 100) : null;

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <p className="mb-1 text-muted-foreground">
        Read from the document{confidence !== null ? ` · confidence ${confidence}%` : ""}{document.extracted_at ? ` · ${formatDateTime(document.extracted_at)}` : ""}{document.extraction_model ? ` · ${document.extraction_model}` : ""}. A proposal: check it against the file; nothing has been changed.
      </p>
      {comparisons.length ? (
        <table className="w-full">
          <tbody>
            {comparisons.map((c) => (
              <tr key={c.field}>
                <td className="py-0.5 pr-2 text-muted-foreground">{c.label}</td>
                <td className="py-0.5 pr-2">{c.document_value ?? "—"}</td>
                <td className="py-0.5 pr-2 text-muted-foreground">form: {c.registration_value ?? "—"}</td>
                <td className="py-0.5 text-right">
                  <Badge variant={c.match === "same" ? "success" : c.match === "differs" ? "warning" : "muted"}>{c.match === "same" ? "same" : c.match === "differs" ? "differs" : "not compared"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Nothing legible was found.</p>
      )}
    </div>
  );
}
