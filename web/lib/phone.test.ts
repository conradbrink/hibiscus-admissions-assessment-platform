import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIALLING_CODE,
  DIALLING_CODES,
  ELSEWHERE_CODE,
  checkMobile,
  checkStoredMobile,
  prettyMobile,
  splitMobile,
} from "@/lib/phone";

describe("checkMobile", () => {
  it("accepts a Botswana mobile, however it is spaced", () => {
    for (const typed of ["71234567", "71 234 567", "71-234-567", "(71) 234 567"]) {
      expect(checkMobile("+267", typed)).toEqual({ ok: true, e164: "+26771234567", pretty: "+267 71 234 567" });
    }
  });

  it("drops a trunk zero the parent is used to dialling", () => {
    expect(checkMobile("+267", "071 234 567")).toMatchObject({ ok: true, e164: "+26771234567" });
    expect(checkMobile("+27", "082 123 4567")).toMatchObject({ ok: true, e164: "+27821234567" });
  });

  it("drops a country code repeated in the number field", () => {
    expect(checkMobile("+267", "+267 71 234 567")).toMatchObject({ ok: true, e164: "+26771234567" });
    expect(checkMobile("+27", "27 82 123 4567")).toMatchObject({ ok: true, e164: "+27821234567" });
  });

  it("refuses a number the country does not issue, and says why", () => {
    const short = checkMobile("+267", "7123456");
    expect(short.ok).toBe(false);
    expect(short.ok === false && short.reason).toContain("8 digits");

    const landline = checkMobile("+267", "3971234");
    expect(landline.ok).toBe(false);

    const za = checkMobile("+27", "12 345 6789");
    expect(za.ok).toBe(false);
    expect(za.ok === false && za.reason).toContain("6, 7 or 8");
  });

  it("refuses an empty field and letters", () => {
    expect(checkMobile("+267", "")).toMatchObject({ ok: false });
    expect(checkMobile("+267", "   ")).toMatchObject({ ok: false });
    expect(checkMobile("+267", "call me")).toMatchObject({ ok: false });
  });

  it("refuses a country that is not on the list", () => {
    expect(checkMobile("+999", "71234567")).toMatchObject({ ok: false });
  });

  it("checks only the shape for somewhere else", () => {
    expect(checkMobile(ELSEWHERE_CODE, "351912345678")).toMatchObject({ ok: true, e164: "+351912345678" });
    expect(checkMobile(ELSEWHERE_CODE, "12")).toMatchObject({ ok: false });
    expect(checkMobile(ELSEWHERE_CODE, "1234567890123456")).toMatchObject({ ok: false });
  });

  it("never returns anything but E.164", () => {
    for (const country of DIALLING_CODES) {
      const sample = country.placeholder;
      const result = checkMobile(country.code, sample);
      expect(result.ok, `${country.name} placeholder ${sample}`).toBe(true);
      if (result.ok) expect(result.e164).toMatch(/^\+\d{7,15}$/);
    }
  });
});

describe("splitMobile", () => {
  it("puts a stored number back into its two fields", () => {
    expect(splitMobile("+26771234567")).toEqual({ dialling: "+267", national: "71234567" });
    expect(splitMobile("+27821234567")).toEqual({ dialling: "+27", national: "821234567" });
  });

  it("opens on Botswana when there is nothing stored", () => {
    expect(splitMobile(null)).toEqual({ dialling: DEFAULT_DIALLING_CODE, national: "" });
    expect(splitMobile("")).toEqual({ dialling: DEFAULT_DIALLING_CODE, national: "" });
  });

  it("keeps a number from somewhere else whole", () => {
    expect(splitMobile("+351912345678")).toEqual({ dialling: ELSEWHERE_CODE, national: "351912345678" });
  });

  it("round-trips every country", () => {
    for (const country of DIALLING_CODES) {
      const checked = checkMobile(country.code, country.placeholder);
      expect(checked.ok).toBe(true);
      if (!checked.ok) continue;
      const parts = splitMobile(checked.e164);
      expect(parts.dialling, country.name).toBe(country.code);
      expect(checkMobile(parts.dialling, parts.national)).toMatchObject({ ok: true, e164: checked.e164 });
    }
  });
});

describe("prettyMobile", () => {
  it("spaces a number the way its country writes it", () => {
    expect(prettyMobile("+26771234567")).toBe("+267 71 234 567");
    expect(prettyMobile("+27821234567")).toBe("+27 82 123 4567");
  });

  it("leaves a number it does not recognise alone", () => {
    expect(prettyMobile("+351912345678")).toBe("+351912345678");
  });
});

describe("the list itself", () => {
  it("has no duplicate dialling codes", () => {
    const codes = DIALLING_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("opens on the school's own country", () => {
    expect(DIALLING_CODES.some((c) => c.code === DEFAULT_DIALLING_CODE)).toBe(true);
  });
});

describe("checkStoredMobile", () => {
  it("accepts what the field produces", () => {
    expect(checkStoredMobile("+26771234567")).toMatchObject({ ok: true, e164: "+26771234567" });
    expect(checkStoredMobile("+27 82 123 4567")).toMatchObject({ ok: true, e164: "+27821234567" });
  });

  it("refuses a landline in a country we have a mobile rule for", () => {
    const landline = checkStoredMobile("+2673971234");
    expect(landline.ok).toBe(false);
    expect(landline.ok === false && landline.reason).toContain("starts with 7");
  });

  it("insists on a country code", () => {
    expect(checkStoredMobile("71234567")).toMatchObject({ ok: false });
    expect(checkStoredMobile("")).toMatchObject({ ok: false });
    expect(checkStoredMobile("+267 call me")).toMatchObject({ ok: false });
  });

  it("takes a country it has no rule for on its shape", () => {
    expect(checkStoredMobile("+351912345678")).toMatchObject({ ok: true });
    expect(checkStoredMobile("+35")).toMatchObject({ ok: false });
  });
});
