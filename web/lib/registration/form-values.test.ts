import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nest } from "@/lib/registration/form-values";
import { familySchema } from "@/lib/registration/schema";

describe("grouping posted form fields", () => {
  it("groups dotted names and keeps plain ones", () => {
    expect(nest({ "primary.firstName": "Kago", "secondary.firstName": "Neo", whatsappOptIn: "1" })).toEqual({
      primary: { firstName: "Kago" },
      secondary: { firstName: "Neo" },
      whatsappOptIn: "1",
    });
  });

  it("never writes onto Object.prototype, whatever the request names its fields", () => {
    // `out["__proto__"]` is the prototype itself, so this used to set
    // `isStaff` on every object in the server process.
    const out = nest({ "__proto__.isStaff": "1", "constructor.prototype": "x", "primary.__proto__": "y", "primary.firstName": "Kago" });
    expect(({} as Record<string, unknown>).isStaff).toBeUndefined();
    expect(Object.getPrototypeOf(out.primary)).toBe(Object.prototype);
    expect(out).toEqual({ primary: { firstName: "Kago" } });
  });

  it("does not crash when a plain field shares a group's name", () => {
    expect(nest({ secondary: "x", "secondary.title": "Mr" })).toEqual({ secondary: { title: "Mr" } });
  });
});

describe("the family form's field names", () => {
  const source = readFileSync(path.resolve(__dirname, "..", "..", "components", "parent", "register", "family-form.tsx"), "utf8");
  const names = [...new Set([...source.matchAll(/"((?:primary|secondary)\.\w+)"/g)].map((m) => m[1]))];
  const GUARDIAN_FIELDS = ["address", "email", "firstName", "gender", "lastName", "mobile", "nationality", "phone", "relationship", "title"];

  it("posts every guardian field, for both guardians, under the names the schema reads", () => {
    // A renamed input would otherwise make every real save fail validation
    // while every schema test, which builds the object by hand, still passed.
    for (const group of ["primary", "secondary"]) {
      expect(names.filter((n) => n.startsWith(`${group}.`)).map((n) => n.split(".")[1]).sort()).toEqual(GUARDIAN_FIELDS);
    }
  });

  it("validates as posted", () => {
    const valid: Record<string, string> = {
      title: "Mrs", firstName: "Neo", lastName: "Moeti", relationship: "mother", gender: "F",
      email: "neo@example.com", mobile: "+26771234568", phone: "", address: "", nationality: "",
    };
    const posted = Object.fromEntries(names.map((n) => {
      const [group, field] = n.split(".");
      const value = group === "primary" && field === "firstName" ? "Kago" : valid[field];
      return [n, value];
    }));
    expect(familySchema.safeParse(nest(posted)).success).toBe(true);
  });
});
