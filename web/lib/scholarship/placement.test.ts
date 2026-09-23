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

  it("matches a class whose key was typed with a stray space", () => {
    // The key is matched against a class name read out of the workbook, so an
    // untrimmed `"Stage 4 "` would match nothing and quietly leave the child at
    // the fallback campus — the one this run was trying to move them off.
    const out = resolvePlacement({
      classNames: ["Stage 4"],
      json: '{"Stage 4 ":"Block 7"}',
      fallback: FALLBACK,
    });
    expect(out).toEqual([{ className: "Stage 4", campusName: "Block 7" }]);
  });

  it("refuses a map that was set to nothing rather than falling back", () => {
    // `PLACEMENT=$SOMETHING_UNSET` expands to the empty string. Treating that
    // as absent would place children at the runner's own campus while the
    // person who typed it believed they had chosen one.
    expect(() =>
      resolvePlacement({
        classNames: ["Stage 4"],
        json: "",
        variable: "SCHOLARSHIP_PLACEMENT",
        fallback: FALLBACK,
      })
    ).toThrow('SCHOLARSHIP_PLACEMENT "" is not valid JSON');
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

  it("trims the class name as well as the campus", () => {
    expect(parsePlacement('{"  Stage 4  ":"Block 7"}', "X")).toEqual([{ className: "Stage 4", campusName: "Block 7" }]);
  });

  it("refuses an entry whose class name is only whitespace", () => {
    expect(() => parsePlacement('{"   ":"Block 7"}', "SCHOLARSHIP_PLACEMENT")).toThrow(
      "SCHOLARSHIP_PLACEMENT has an entry with no class name"
    );
  });

  it("refuses the same class twice under different spacing", () => {
    // JSON itself drops an exactly repeated key, so the only way to name one
    // class twice is with whitespace — and then which campus wins would be a
    // matter of key order.
    expect(() => parsePlacement('{"Stage 4":"Block 7","Stage 4 ":"Broadhurst"}', "SCHOLARSHIP_PLACEMENT")).toThrow(
      'SCHOLARSHIP_PLACEMENT names "Stage 4" twice'
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
