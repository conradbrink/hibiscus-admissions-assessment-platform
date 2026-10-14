import { describe, expect, it } from "vitest";
import { pdfSubjectOf } from "@/lib/staff/page-pdf";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("Download PDF: whose Audit tab a press is filed on", () => {
  it("files an applicant's page and their registration on the applicant", () => {
    expect(pdfSubjectOf(`/staff/applications/${ID}`)).toEqual({ applicationId: ID, familyId: null });
    expect(pdfSubjectOf(`/staff/applications/${ID}?tab=audit`)).toEqual({ applicationId: ID, familyId: null });
    expect(pdfSubjectOf(`/staff/registrations/${ID}`)).toEqual({ applicationId: ID, familyId: null });
  });

  it("files a family's page on the family", () => {
    expect(pdfSubjectOf(`/staff/crm/families/${ID}`)).toEqual({ applicationId: null, familyId: ID });
  });

  it("files a list, a new form or anything not shaped like an id on nobody", () => {
    for (const path of ["/staff/applications", `/staff/applications?q=${ID}`, "/staff/applications/new", "/staff/crm/families", "/staff", `/a/${ID}`, `/staff/registrations/${ID},x`]) {
      expect(pdfSubjectOf(path), path).toEqual({ applicationId: null, familyId: null });
    }
  });
});
