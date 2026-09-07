import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { AgreementsDocument, signaturePathFrom } from "@/lib/documents/agreements-pdf";
import { RegistrationDocument } from "@/lib/documents/registration-pdf";
import { signatureSvg } from "@/lib/registration/signature";

describe("staff record PDFs", () => {
  it("renders the registration record", async () => {
    const element = createElement(RegistrationDocument, {
      logoUrl: null,
      letterhead: { name: "Block 7", descriptor: "Secondary", address: "Plot 1\nGaborone" },
      studentName: "Naledi Moeti",
      gradeName: "Form 2",
      campusName: "Block 7",
      intakeLabel: "Term 1, 2027",
      reference: "HBS-2026-00010",
      status: "registration_incomplete",
      submittedOn: null,
      printedOn: "7 September 2026",
      sections: [{ heading: "Student", fields: [{ label: "Legal name", value: "Naledi Moeti" }, { label: "Allergies", value: null }] }],
      documents: [{ label: "Birth certificate", status: "Accepted", filename: "bc.jpg", uploadedOn: "6 September 2026" }],
      agreements: [{ name: "Parent Policy", version: 2, acceptedOn: "6 September 2026", signedBy: "K Moeti" }],
    }) as unknown as ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(element);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders the signed agreements with the signature redrawn from its path", async () => {
    const svg = signatureSvg([[[10, 10], [200, 120], [300, 40]]]);
    const path = signaturePathFrom(svg);
    expect(path).toMatch(/^M10 10 L200 120 L300 40$/);
    expect(signaturePathFrom("<img src=x>")).toBeNull();
    const element = createElement(AgreementsDocument, {
      logoUrl: null,
      letterhead: null,
      studentName: "Naledi Moeti",
      reference: "HBS-2026-00010",
      printedOn: "7 September 2026",
      agreements: [
        { name: "Parent Policy", version: 2, bodyHtml: "<h2>Parent Policy</h2><p>One.</p><p>Two.</p>", signatureName: "K Moeti", signaturePath: path, acceptedOn: "6 September 2026", bodyHash: "abcdef0123456789abcdef" },
        { name: "Fees Policy", version: 1, bodyHtml: "<p>Fees.</p>", signatureName: "K Moeti", signaturePath: null, acceptedOn: "6 September 2026", bodyHash: "0123" },
      ],
    }) as unknown as ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(element);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
