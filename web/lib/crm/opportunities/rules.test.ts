import { describe, expect, it } from "vitest";
import { convertedByCatalogue, describeConditions, familyQualifies, parseConditions, studentQualifies, type StudentFacts } from "@/lib/crm/opportunities/rules";

const student = (over: Partial<StudentFacts> = {}): StudentFacts => ({ id: "s1", family_id: "f1", campus_id: "c1", status: "active", grade_sort: 100, registered_item_codes: [], ...over });

describe("parseConditions", () => {
  it("reads the JSON the settings screen stores and ignores junk", () => {
    expect(parseConditions({ subject: "student", grade_sort_min: 90, grade_sort_max: "x", campus_ids: ["c1", 3], not_registered_item: "robotics", multiple_children_one_enrolled: "yes" })).toEqual({
      subject: "student",
      grade_sort_min: 90,
      grade_sort_max: undefined,
      campus_ids: ["c1"],
      student_statuses: undefined,
      not_registered_item: "robotics",
      multiple_children_one_enrolled: false,
      reenrolment_outstanding: false,
    });
    expect(parseConditions(null)).toEqual({});
    expect(parseConditions([1])).toEqual({});
  });
});

describe("studentQualifies", () => {
  it("a robotics rule: the right grades, enrolled, not already registered", () => {
    const c = parseConditions({ subject: "student", grade_sort_min: 90, grade_sort_max: 120, not_registered_item: "robotics" });
    expect(studentQualifies(c, student())).toBe(true);
    expect(studentQualifies(c, student({ grade_sort: 60 }))).toBe(false);
    expect(studentQualifies(c, student({ grade_sort: 130 }))).toBe(false);
    expect(studentQualifies(c, student({ grade_sort: null }))).toBe(false);
    expect(studentQualifies(c, student({ registered_item_codes: ["robotics"] }))).toBe(false);
    expect(studentQualifies(c, student({ status: "left" }))).toBe(false);
    expect(studentQualifies(c, student({ status: "onboarding" }))).toBe(true);
  });
  it("respects a campus list and an explicit status list", () => {
    const c = parseConditions({ campus_ids: ["c2"], student_statuses: ["left"] });
    expect(studentQualifies(c, student())).toBe(false);
    expect(studentQualifies(c, student({ campus_id: "c2", status: "left" }))).toBe(true);
  });
  it("a family rule never fires per student", () => {
    expect(studentQualifies(parseConditions({ subject: "family", multiple_children_one_enrolled: true }), student())).toBe(false);
  });
});

describe("familyQualifies", () => {
  it("additional enrolment: more than one child, one enrolled", () => {
    const c = parseConditions({ subject: "family", multiple_children_one_enrolled: true });
    expect(familyQualifies(c, { id: "f1", campus_id: "c1", student_count: 2, enrolled_count: 1, reenrolment_outstanding: 0 })).toBe(true);
    expect(familyQualifies(c, { id: "f1", campus_id: "c1", student_count: 2, enrolled_count: 2, reenrolment_outstanding: 0 })).toBe(false);
    expect(familyQualifies(c, { id: "f1", campus_id: "c1", student_count: 1, enrolled_count: 1, reenrolment_outstanding: 0 })).toBe(false);
  });
  it("re-enrolment outstanding", () => {
    const c = parseConditions({ subject: "family", reenrolment_outstanding: true });
    expect(familyQualifies(c, { id: "f1", campus_id: "c1", student_count: 1, enrolled_count: 1, reenrolment_outstanding: 1 })).toBe(true);
    expect(familyQualifies(c, { id: "f1", campus_id: "c1", student_count: 1, enrolled_count: 1, reenrolment_outstanding: 0 })).toBe(false);
  });
  it("a family rule with no test at all fires for nobody", () => {
    expect(familyQualifies(parseConditions({ subject: "family" }), { id: "f1", campus_id: "c1", student_count: 5, enrolled_count: 1, reenrolment_outstanding: 3 })).toBe(false);
  });
  it("a student rule never fires per family", () => {
    expect(familyQualifies(parseConditions({ multiple_children_one_enrolled: true }), { id: "f1", campus_id: "c1", student_count: 2, enrolled_count: 1, reenrolment_outstanding: 0 })).toBe(false);
  });
});

describe("convertedByCatalogue and describeConditions", () => {
  it("closes the loop when the child holds the item", () => {
    const c = parseConditions({ not_registered_item: "swimming" });
    expect(convertedByCatalogue(c, { registered_item_codes: ["swimming"] })).toBe(true);
    expect(convertedByCatalogue(c, { registered_item_codes: [] })).toBe(false);
    expect(convertedByCatalogue(parseConditions({}), { registered_item_codes: ["swimming"] })).toBe(false);
  });
  it("describes the rule in words, using grade names when it has them", () => {
    const names: Record<number, string> = { 90: "Stage 4", 120: "Stage 7" };
    expect(describeConditions(parseConditions({ grade_sort_min: 90, grade_sort_max: 120, not_registered_item: "robotics" }), (s) => names[s] ?? null)).toBe('a child in Stage 4 to Stage 7, not registered for "robotics"');
    expect(describeConditions(parseConditions({ subject: "family", multiple_children_one_enrolled: true, campus_ids: ["c1"] }))).toBe("a family with more than one child and only one enrolled, at 1 named campus");
    expect(describeConditions(parseConditions({}))).toBe("any enrolled child");
  });
});
