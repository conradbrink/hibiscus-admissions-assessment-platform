"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { recordPagePdf } from "@/app/staff/page-pdf-actions";

/**
 * Download PDF: the page as it is on screen, without the menus (the print
 * rules in globals.css take those away), through the browser's own
 * print-to-PDF. One button for every staff page rather than a document per
 * page: a list, a family, an applicant or a report all come out as the
 * person sees them, filters and all.
 *
 * Shown only to holders of `pages.export_pdf`. The press is recorded first,
 * and only then does the browser's dialog open, with "Save as PDF" to hand;
 * a press that cannot be recorded says so and makes nothing.
 */
export function PagePdfButton({ className }: { className: string }) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label="Download this page as a PDF"
      title="Download this page as a PDF"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const recorded = await recordPagePdf(pathname);
          if (recorded.ok) window.print();
          else window.alert(recorded.error);
        } catch {
          window.alert("The download could not be recorded, so it was not made. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileDown className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
