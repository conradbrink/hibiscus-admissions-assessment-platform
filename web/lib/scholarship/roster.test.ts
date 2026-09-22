import { describe, expect, it } from "vitest";
import {
  emailsIn,
  looksLikeEmail,
  mobilesIn,
  promotionCodeFor,
  readRoster,
  splitName,
  toBotswanaE164,
} from "@/lib/scholarship/roster";

const HEADER = ["", "APPLICANT NAME", "CLASS", "PARENT/GUARDIAN", "PARENT EMAIL", "PARENT CONTACT", "AWARD"];

describe("phone numbers as the spreadsheet actually holds them", () => {
  it("unpicks a number a spreadsheet turned into a float", () => {
    // Straight out of the file: 76795094 stored as 7.6795094E7.
    expect(mobilesIn("7.6795094E7")).toEqual(["76795094"]);
    expect(toBotswanaE164("76795094")).toBe("+26776795094");
  });

  it("takes the first of two numbers and keeps the rest", () => {
    expect(mobilesIn("72556155 - 73687525")).toEqual(["72556155", "73687525"]);
    expect(mobilesIn("75779983 - 72792136 - 71806424")).toHaveLength(3);
  });

  it("accepts a plain eight-digit number and one already in E.164", () => {
    expect(toBotswanaE164("71299056")).toBe("+26771299056");
    expect(toBotswanaE164("+267 71 299 056")).toBe("+26771299056");
    expect(toBotswanaE164("26771299056")).toBe("+26771299056");
  });

  it("refuses anything that is not a Botswana mobile", () => {
    // A landline, a too-short number, a South African one: all wrong here,
    // and a wrong number is worse than a refused row.
    expect(toBotswanaE164("3117007")).toBeNull();
    expect(toBotswanaE164("7129905")).toBeNull();
    expect(toBotswanaE164("0610975213")).toBeNull();
    expect(toBotswanaE164("")).toBeNull();
  });
});

describe("email cells", () => {
  it("splits two addresses in one cell", () => {
    expect(emailsIn("smphomonica@yahoo.com; goemeonekagiso@gmail.com")).toHaveLength(2);
  });

  it("spots the missing dot", () => {
    // Real row: fenterh@gmailcom. A person must fix this; guessing the dot
    // would send a child's scholarship letter into the void.
    expect(looksLikeEmail("fenterh@gmailcom")).toBe(false);
    expect(looksLikeEmail("tmwihaki35@gmail.com")).toBe(true);
    expect(looksLikeEmail("g.ntshontsi@yahoo.co.uk")).toBe(true);
  });
});

describe("names", () => {
  it("keeps the calling name first and the rest together", () => {
    expect(splitName("Penelope Resego Mbaiwa")).toEqual({ first: "Penelope", last: "Resego Mbaiwa" });
    expect(splitName("Chedza Tabulawa")).toEqual({ first: "Chedza", last: "Tabulawa" });
  });

  it("survives a single word and stray spacing", () => {
    expect(splitName("Lebone")).toEqual({ first: "Lebone", last: "Lebone" });
    expect(splitName("  Lebone   Sedi  Manyaapelo ")).toEqual({ first: "Lebone", last: "Sedi Manyaapelo" });
    expect(splitName("")).toEqual({ first: "", last: "" });
  });
});

describe("awards", () => {
  it("maps the band and ignores the reason", () => {
    // Four bands, not twelve: why the school gave it is not what it is worth.
    expect(promotionCodeFor("Academic 50%")).toBe("SCHOLARSHIP-50");
    expect(promotionCodeFor("Academic 40%")).toBe("SCHOLARSHIP-40");
    expect(promotionCodeFor("Sports 30%")).toBe("SCHOLARSHIP-30");
    expect(promotionCodeFor("Cultural 20%")).toBe("SCHOLARSHIP-20");
  });

  it("refuses a cell with no percentage in it", () => {
    expect(promotionCodeFor("Academic")).toBeNull();
    expect(promotionCodeFor("")).toBeNull();
    expect(promotionCodeFor("0%")).toBeNull();
  });
});

describe("reading the workbook", () => {
  const sheet = (name: string, rows: string[][]) => ({ name, rows: [HEADER, ...rows] });

  it("reads a good row into something sendable", () => {
    const { rows, problems } = readRoster([
      sheet("Sheet1", [
        ["1.0", "Penelope Resego Mbaiwa", "Form 1", "Masego Mercy Mbaiwa", "motlogetswe@gmail.com", "7.6795094E7", "Academic 50%"],
      ]),
    ]);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentFirstName: "Penelope",
      studentLastName: "Resego Mbaiwa",
      parentFirstName: "Masego",
      email: "motlogetswe@gmail.com",
      mobile: "+26776795094",
      className: "Form 1",
      promotionCode: "SCHOLARSHIP-50",
    });
  });

  it("refuses the three rows a person has to fix, and says which", () => {
    const { rows, problems } = readRoster([
      sheet("Sheet2", [
        ["24.0", "Larona Tlotliso Faith Setlhare", "Form 3", "Josephinah Onah Setlhare", "", "74130016 - 72889337", "Academic 40%"],
        ["3.0", "Tanyaradzwa Vivian Chibaya", "Form 1", "Patience Chibaya", "fenterh@gmailcom", "7.6143769E7", "Academic 40%"],
        ["9.0", "No Award Child", "Form 2", "A Parent", "a@example.com", "71234567", ""],
      ]),
    ]);
    expect(rows).toEqual([]);
    expect(problems.map((p) => p.why)).toEqual([
      "no email address",
      'email "fenterh@gmailcom" is not a valid address',
      'award "(blank)" does not name a percentage',
    ]);
    expect(problems[0]).toMatchObject({ sheet: "Sheet2", line: 2, student: "Larona Tlotliso Faith Setlhare" });
  });

  it("notes what it chose rather than silently choosing", () => {
    const { rows } = readRoster([
      sheet("Sheet1", [
        ["4.0", "Mosa Lee James Kagiso", "Form 2", "Mpho Monica Sentle", "smphomonica@yahoo.com; goemeonekagiso@gmail.com", "75779983 - 72792136", "Academic 50%"],
      ]),
    ]);
    expect(rows[0].email).toBe("smphomonica@yahoo.com");
    expect(rows[0].mobile).toBe("+26775779983");
    expect(rows[0].notes).toEqual([
      "second address on file: goemeonekagiso@gmail.com",
      "other numbers on file: +26772792136",
    ]);
  });

  it("skips the header and blank rows without complaining about them", () => {
    const { rows, problems } = readRoster([sheet("Sheet1", [["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""]])]);
    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("reads every sheet, because the bands are split across three", () => {
    const { rows } = readRoster([
      sheet("Sheet1", [["1.0", "A Child", "Form 1", "A Parent", "a@example.com", "71111111", "Academic 50%"]]),
      sheet("Sheet3", [["1.0", "B Child", "Form 4", "B Parent", "b@example.com", "72222222", "Sports 30%"]]),
    ]);
    expect(rows.map((r) => r.promotionCode)).toEqual(["SCHOLARSHIP-50", "SCHOLARSHIP-30"]);
    expect(rows.map((r) => r.sheet)).toEqual(["Sheet1", "Sheet3"]);
  });
});
