import { describe, expect, it } from "vitest";
import { parsePlacement, resolvePlacement, type Placement } from "@/lib/scholarship/placement";

/** What the runner was built with, and still falls back to. */
const FALLBACK: Placement[] = [
  { className: "Form 1", campusName: "Block 7" },
  { className: "Stage 4", campusName: "Broadhurst" },
  { className: "Stage 5", campusName: "Broadhurst" },
];

describe("resolving where a file's children go", () => {
  it("places every class at one campus when the run names one", () => {
    const out = resolvePlacement({
      classNames: ["Stage 4", "Stage 5", "Stage 6"],
      campus: "Block 7",
      fallback: FALLBACK,
    });
    expect(out).toEqual([
      { className: "Stage 4", campusName: "Block 7" },
      { className: "Stage 5", campusName: "Block 7" },
      { className: "Stage 6", campusName: "Block 7" },
    ]);
  });

  it("falls back to the runner's own list when the run names nothing", () => {
    const out = resolvePlacement({ classNames: ["Stage 4", "Form 1"], fallback: FALLBACK });
    expect(out).toEqual([
      { className: "Stage 4", campusName: "Broadhurst" },
      { className: "Form 1", campusName: "Block 7" },
    ]);
  });

  it("lets the map decide one class and the campus decide the rest", () => {
    // The real shape of a mixed file: almost all of it is one campus, and a
    // line of JSON moves the exceptions. A full map would have to restate
    // every class to change one of them.
    const out = resolvePlacement({
      classNames: ["Stage 4", "Stage 5", "Form 1"],
      campus: "Broadhurst",
      json: '{"Form 1":"Block 7"}',
      fallback: FALLBACK,
    });
    expect(out).toEqual([
      { className: "Stage 4", campusName: "Broadhurst" },
      { className: "Stage 5", campusName: "Broadhurst" },
      { className: "Form 1", campusName: "Block 7" },
    ]);
  });

  it("leaves out a class nobody placed, rather than guessing one", () => {
    // Stage 7 is taught at two campuses. Left out, it resolves to no grade,
    // every row in it is refused, and the runner stops before the commit
    // flag — which is the right end for "nobody said where these children go".
    const out = resolvePlacement({ classNames: ["Stage 4", "Stage 7"], fallback: FALLBACK });
    expect(out).toEqual([{ className: "Stage 4", campusName: "Broadhurst" }]);
  });

  it("places each class once, however often it appears in the file", () => {
    const out = resolvePlacement({
      classNames: ["Stage 4", "Stage 4", "Stage 4"],
      campus: "Broadhurst",
      fallback: [],
    });
    expect(out).toEqual([{ className: "Stage 4", campusName: "Broadhurst" }]);
  });

  it("ignores a campus that is only whitespace", () => {
    const out = resolvePlacement({ classNames: ["Stage 4"], campus: "   ", fallback: FALLBACK });
    expect(out).toEqual([{ className: "Stage 4", campusName: "Broadhurst" }]);
  });
});

describe("reading the placement map a person typed", () => {
  it("reads a class-to-campus object", () => {
    expect(parsePlacement('{"Form 1":"Block 7","Stage 4":" Broadhurst "}', "X")).toEqual([
      { className: "Form 1", campusName: "Block 7" },
      { className: "Stage 4", campusName: "Broadhurst" },
    ]);
  });

  it("refuses what is not JSON, quoting what was typed", () => {
    // Not ignored: a mistyped variable that quietly fell back would place
    // children at the campus the runner was built with while the person who
    // typed it believed they had moved them.
    expect(() => parsePlacement("Broadhurst", "SCHOLARSHIP_PLACEMENT")).toThrow(
      'SCHOLARSHIP_PLACEMENT "Broadhurst" is not valid JSON'
    );
  });

  it("refuses a list, which is the shape people reach for first", () => {
    expect(() => parsePlacement('["Block 7"]', "SCHOLARSHIP_PLACEMENT")).toThrow(
      /must be an object of class name to campus name/
    );
  });

  it("refuses an entry with no campus, naming the class", () => {
    expect(() => parsePlacement('{"Stage 4":""}', "SCHOLARSHIP_PLACEMENT")).toThrow(
      'SCHOLARSHIP_PLACEMENT entry "Stage 4" must name a campus'
    );
    expect(() => parsePlacement('{"Stage 4":5}', "SCHOLARSHIP_PLACEMENT")).toThrow(
      'SCHOLARSHIP_PLACEMENT entry "Stage 4" must name a campus'
    );
  });
});
