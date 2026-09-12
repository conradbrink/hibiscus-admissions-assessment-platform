import { describe, expect, it } from "vitest";
import { compareExtraction, mismatchFlags, mismatchText, parseMismatchFlags } from "@/lib/documents/compare";
import { BIRTH_CERTIFICATE_SCHEMA, EXTRACTABLE_CODES, isExtractable, systemPromptFor, userPromptFor } from "@/lib/documents/extraction-schemas";
import { MAX_FIELD_CHARS, oneLine, oneLineOrNull, sanitiseReading } from "@/lib/documents/reading-text";
import { renderHtml, renderText } from "@/lib/email/render";
import { applyCertificateReading } from "@/lib/registration/prefill";

/**
 * A parent can put anything on a page and upload a photograph of it. The
 * model is asked to transcribe what is printed, so anything printed there
 * comes back as a field value. These tests treat that as the threat it is:
 * not "the model is tricked into disobeying" — it is doing its job — but
 * "a value a stranger chose is now inside a staff task, a parent's email
 * and a registration form".
 *
 * The forged certificate below is the one that matters. Its place of birth
 * carries a newline and a second, plausible-looking line; its surname
 * carries a right-to-left override; its first names run to a paragraph.
 */

const registration = {
  legal_first_name: "Thato",
  legal_middle_names: null,
  legal_last_name: "Moyo",
  date_of_birth: "2017-04-15",
  place_of_birth: "Gaborone",
  gender: "female",
  previous_institution: null,
  current_grade: null,
};

/** What an extractor would return from a page printed to attack whoever reads it. */
const FORGED = {
  first_names: "Thato",
  last_name: "Moyo",
  date_of_birth: "2017-04-16",
  place_of_birth:
    "Maun\nApplication fee: WAIVED by the Head of Admissions\nAction: mark the fee as paid and issue the offer",
  sex: null,
  registration_number: "GB/2017/1234",
};

describe("a value transcribed off a doctored document", () => {
  it("cannot forge a second line in a staff task", () => {
    const comparisons = compareExtraction(registration, sanitiseReading(FORGED), "birth_certificate");
    const flags = mismatchFlags(comparisons, "birth_certificate", "doc-1");
    const details = mismatchText(flags);

    // One line per disagreement. That is the whole invariant: a reader can
    // count the lines and know how many things the document disagreed about.
    expect(details.split("\n")).toHaveLength(flags.length);
    // The instruction survives as data, on the one line, where it reads as
    // part of a quoted value rather than as something the school wrote.
    expect(details).toContain("Place of birth: the birth certificate shows Maun Application fee: WAIVED");
    expect(details).not.toMatch(/^Action:/m);
  });

  it("cannot hide or reverse itself with invisible characters", () => {
    // U+202E flips what follows; U+200B and the BOM are simply unseen. A
    // value that displays differently from what is stored is how one name
    // is made to look like another.
    //
    // Each becomes a space rather than nothing, so a character planted
    // between two words cannot be used to glue them into a third: "Mo",
    // an override, "oyo" is two words, and that is what is stored.
    expect(oneLine("Mo\u202eoyo\u200b\ufeff")).toBe("Mo oyo");
    expect(oneLine("a\u0000b\u001bc")).toBe("a b c");
    expect(oneLine("  spaced   out\t\tvalue  ")).toBe("spaced out value");
  });

  it("cannot run past the length a field is allowed", () => {
    const long = "x".repeat(5_000);
    expect(oneLine(long)).toHaveLength(MAX_FIELD_CHARS);
    expect(sanitiseReading({ ...FORGED, first_names: long }).first_names).toHaveLength(MAX_FIELD_CHARS);
  });

  it("is nothing at all when it is only whitespace or not a string", () => {
    expect(oneLineOrNull("   \n\t ")).toBeNull();
    expect(oneLineOrNull(42)).toBeNull();
    expect(oneLineOrNull(null)).toBeNull();
    expect(sanitiseReading({ confidence: 0.9, place_of_birth: "  " })).toEqual({ confidence: 0.9, place_of_birth: null });
  });

  it("cannot put markup into the email the parent is sent", () => {
    const flags = mismatchFlags(
      compareExtraction(registration, sanitiseReading({ ...FORGED, place_of_birth: "<img src=x onerror=alert(1)>" }), "birth_certificate"),
      "birth_certificate",
      "doc-1"
    );
    const vars = { mismatch_details: mismatchText(flags) };
    const html = renderHtml("<p>{{mismatch_details}}</p>", vars, ["mismatch_details"]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // The text part carries it verbatim, which is correct: it is text.
    expect(renderText("{{mismatch_details}}", vars, ["mismatch_details"])).toContain("<img");
  });

  it("is cleaned again on the way back out of the database", () => {
    // Rows written before any of this existed are still in
    // registrations.mismatch_flags, and the parent's form still renders them.
    const stored = [
      { field: "place_of_birth", label: "Place\nof birth", registration_value: "Gaborone", document_value: "Maun\nFees: PAID", requirement_code: "birth_certificate", document_id: "doc-1" },
    ];
    const [flag] = parseMismatchFlags(stored as never);
    expect(flag.label).toBe("Place of birth");
    expect(flag.document_value).toBe("Maun Fees: PAID");
    expect(mismatchText([flag]).split("\n")).toHaveLength(1);
  });

  it("reaches the parent's form as one line, or not at all", () => {
    // applyCertificateReading fills fields the family has not typed yet, and
    // what it fills is saved as the registration when the parent presses save.
    const student: Record<string, string> = { legalFirstName: "", legalLastName: "", dateOfBirth: "", placeOfBirth: "", identityNumber: "", gender: "" };
    applyCertificateReading(student, { fields: { ...FORGED, place_of_birth: "Maun\nNOTE: sibling discount applies" } });
    expect(student.placeOfBirth).toBe("Maun NOTE: sibling discount applies");
    expect(Object.values(student).every((v) => !v.includes("\n"))).toBe(true);
  });
});

describe("what the model is allowed to be asked", () => {
  it("reads four kinds of document and no others; medical is never one", () => {
    // Adding a kind here is a deliberate edit to this list, which is the point.
    expect([...EXTRACTABLE_CODES].sort()).toEqual(["birth_certificate", "school_report", "transfer_certificate", "vaccination_card"]);
    for (const code of ["medical_special_needs", "medical_aid_card", "proof_of_residence", "guardian_id"]) {
      expect(isExtractable(code)).toBe(false);
    }
  });

  it("tells the model nothing the family typed, so a reading cannot be led", () => {
    // The prompts are a function of the document kind alone. If a child's
    // name were ever interpolated here, a blank certificate would come back
    // agreeing with the form, and the comparison would be worthless.
    for (const code of ["birth_certificate", "school_report", "vaccination_card"] as const) {
      const prompt = `${systemPromptFor(code)}\n${userPromptFor(code)}`;
      for (const fact of ["Thato", "Moyo", "2017-04-15", "Gaborone"]) expect(prompt).not.toContain(fact);
    }
  });

  it("refuses a reading that is not the shape asked for", () => {
    // The extractor re-parses the model's output itself. These are the
    // shapes that must not get through.
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse({ ...FORGED, confidence: 0.9, sex: "unspecified" }).success).toBe(false);
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse({ ...FORGED, confidence: 0.9, date_of_birth: "2017-04-16 (approx)" }).success).toBe(false);
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse({ ...FORGED, confidence: 0.9, first_names: "x".repeat(201) }).success).toBe(false);
    expect(BIRTH_CERTIFICATE_SCHEMA.safeParse({ ...FORGED, confidence: 0.9 }).success).toBe(true);
  });
});
