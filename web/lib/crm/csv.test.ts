import { describe, expect, it } from "vitest";
import { FAMILY_COLUMNS, csvLine, duplicatesWithinFile, mapHeaders, parseCsv, toCsv, validateRow, type ImportRecord } from "@/lib/crm/csv";

describe("parseCsv", () => {
  it("reads quotes, escaped quotes, CRLF and a BOM", () => {
    const t = parseCsv('﻿First Name,Surname,Email,Notes\r\nAnna,Brink,anna@example.com,"Says ""hi"", twice"\r\n\r\nBen,"O\'Neil",ben@example.com,\n');
    expect(t.headers).toEqual(["first_name", "surname", "email", "notes"]);
    expect(t.rows).toEqual([
      ["Anna", "Brink", "anna@example.com", 'Says "hi", twice'],
      ["Ben", "O'Neil", "ben@example.com", ""],
    ]);
  });
  it("handles a newline inside quotes and an empty file", () => {
    expect(parseCsv('a,b\n1,"x\ny"').rows).toEqual([["1", "x\ny"]]);
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("mapHeaders", () => {
  it("recognises the columns and the usual aliases, and reports the rest", () => {
    const m = mapHeaders(["first_name", "surname", "e_mail", "cell", "shoe_size"]);
    expect(m.map).toEqual(["first_name", "last_name", "email", "mobile", null]);
    expect(m.unknown).toEqual(["shoe_size"]);
    expect(m.missing).toEqual([]);
  });
  it("names the required columns that are missing", () => {
    expect(mapHeaders(["email"]).missing).toEqual(["first_name", "last_name"]);
  });
  it("every documented column maps to itself", () => {
    expect(mapHeaders([...FAMILY_COLUMNS]).map).toEqual([...FAMILY_COLUMNS]);
  });
});

describe("validateRow", () => {
  const campuses = new Set(["gaborone", "francistown"]);
  const headers = mapHeaders(["first_name", "last_name", "email", "mobile", "campus", "relationship", "lead_source", "tags", "marketing_email", "whatsapp_updates"]).map;
  it("builds a record, normalising what it can", () => {
    const v = validateRow(headers, ["  Anna ", "Brink", "Anna@Example.com", "71 234 567", "Gaborone", "Mother", "Current Parent", "VIP; New Lead", "yes", "no"], campuses);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.record.first_name).toBe("Anna");
    expect(v.record.last_name).toBe("Brink");
    expect(v.record.email_normalised).toBe("anna@example.com");
    expect(v.record.mobile_normalised).toBe("+26771234567");
    expect(v.record.campus).toBe("gaborone");
    expect(v.record.relationship).toBe("mother");
    expect(v.record.lead_source).toBe("current_parent");
    expect(v.record.tags).toEqual(["vip", "new-lead"]);
    expect(v.record.marketing_email).toBe(true);
    expect(v.record.whatsapp_updates).toBe(false);
    expect(v.warnings).toEqual([]);
  });
  it("refuses a row without the essentials or with a campus the school lacks", () => {
    const v = validateRow(headers, ["", "Brink", "not-an-email", "", "Mars", "", "", "", "", ""], campuses);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toHaveLength(3);
    expect(v.errors.join(" ")).toMatch(/First name/);
    expect(v.errors.join(" ")).toMatch(/not an email/);
    expect(v.errors.join(" ")).toMatch(/Mars/);
  });
  it("warns rather than refuses on a number it cannot read, an odd relationship, an unknown source", () => {
    const v = validateRow(headers, ["Anna", "Brink", "anna@example.com", "12", "", "Aunt", "Carrier pigeon", "", "", ""], campuses);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.record.mobile).toBe("12");
    expect(v.record.mobile_normalised).toBeNull();
    expect(v.record.relationship).toBe("parent");
    expect(v.record.lead_source).toBe("other");
    expect(v.warnings).toHaveLength(3);
  });
});

describe("duplicatesWithinFile", () => {
  const rec = (email: string, mobile: string | null): ImportRecord => ({
    family_name: null, first_name: "A", last_name: "B", email, email_normalised: email.toLowerCase(), mobile, mobile_normalised: mobile, relationship: "parent", campus: null, lead_source: null, address: null, language: null, preferred_channel: null, tags: [], notes: null, marketing_email: false, marketing_whatsapp: false, sms: false, whatsapp_updates: false,
  });
  it("points a repeated email or number at the earlier row", () => {
    const d = duplicatesWithinFile([
      { index: 0, record: rec("a@x.com", "+26771234567") },
      { index: 1, record: rec("A@x.com", null) },
      { index: 2, record: rec("b@x.com", "+26771234567") },
      { index: 3, record: rec("c@x.com", "+26771234568") },
    ]);
    expect([...d.entries()]).toEqual([
      [1, "Same email as row 1."],
      [2, "Same mobile number as row 1."],
    ]);
  });
});

describe("csv out", () => {
  it("quotes only what needs it", () => {
    expect(csvLine(["a", 'b "c"', "d,e", null, 3, true])).toBe('a,"b ""c""","d,e",,3,true');
    expect(toCsv(["x", "y"], [["1", "2"]])).toBe("x,y\r\n1,2\r\n");
  });
});
