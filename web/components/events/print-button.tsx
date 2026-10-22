"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Print the tickets, or save them as a PDF from the print screen. */
export function PrintButton() {
  return (
    <Button type="button" size="parent" variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer data-icon="inline-start" /> Print or save the tickets
    </Button>
  );
}
