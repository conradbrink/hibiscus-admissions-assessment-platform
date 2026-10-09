import { describe, expect, it } from "vitest";
import { KEYS } from "@/lib/settings";
import { fieldFor, formatSetting, parseSetting, SECTIONS, SETTING_FIELDS } from "./fields";

describe("the catalogue covers what the engine reads", () => {
  it("labels every setting getSettings consults", () => {
    // The test that keeps this honest: add a setting to `Settings` and this
    // fails until somebody says what it is called and what kind of thing it
    // is. Without it the new row silently lands in the raw JSON box.
    const unlabelled = Object.values(KEYS).filter((key) => !fieldFor(key));
    expect(unlabelled).toEqual([]);
  });

  it("puts every field in a section the page renders", () => {
    const strays = Object.entries(SETTING_FIELDS)
      .filter(([, f]) => !(SECTIONS as readonly string[]).includes(f.section))
      .map(([k]) => k);
    expect(strays).toEqual([]);
  });

  it("leaves an unknown key to the raw box rather than guessing", () => {
    expect(fieldFor("something_a_migration_added_today")).toBeNull();
  });
});

describe("parseSetting", () => {
  it("takes one whole number, and refuses a list where one is meant", () => {
    expect(parseSetting("int", " 14 ", "Days")).toBe(14);
    expect(() => parseSetting("int", "7, 2", "Days")).toThrow(/one whole number/);
    expect(() => parseSetting("int", "0", "Days")).toThrow(/above zero/);
    expect(() => parseSetting("int", "two", "Days")).toThrow(/not a whole number/);
  });

  it("allows midnight for an hour, because 0 is a time and not an absence", () => {
    // The old save refused it: `value > 0`. A school wanting the digest at
    // midnight could not have it.
    expect(parseSetting("hour", "0", "Digest")).toBe(0);
    expect(parseSetting("hour", "23", "Digest")).toBe(23);
    expect(() => parseSetting("hour", "24", "Digest")).toThrow(/0 to 23/);
  });

  it("reads a comma list the way somebody would write one", () => {
    expect(parseSetting("intList", "7, 2", "Reminders")).toEqual([7, 2]);
    expect(parseSetting("intList", "7,2", "Reminders")).toEqual([7, 2]);
    expect(() => parseSetting("intList", "", "Reminders")).toThrow(/at least one number/);
  });

  it("takes zero in a list where the day itself is a real answer", () => {
    expect(parseSetting("intList0", "7, 0", "Follow-ups")).toEqual([7, 0]);
    expect(() => parseSetting("intList", "7, 0", "Reminders")).toThrow(/above zero/);
  });

  it("stores clock times as minutes after midnight", () => {
    expect(parseSetting("timeList", "08:00, 10:30", "Starts")).toEqual([480, 630]);
    expect(parseSetting("timeList", "00:00", "Starts")).toEqual([0]);
  });

  it("insists the times are in order and distinct", () => {
    // `asMinutesList` throws away the whole list otherwise, and the sitting
    // generator then quietly runs fewer sittings than the school asked for.
    expect(() => parseSetting("timeList", "10:00, 08:00", "Starts")).toThrow(/in order/);
    expect(() => parseSetting("timeList", "08:00, 08:00", "Starts")).toThrow(/no repeats/);
    expect(() => parseSetting("timeList", "8am", "Starts")).toThrow(/not a time/);
    expect(() => parseSetting("timeList", "25:00", "Starts")).toThrow(/not a time of day/);
  });

  it("takes a date, which the old editor could not save at all", () => {
    // `"2026-10-17"` parsed as a JSON string and was refused, so the
    // scholarship deadline could only be moved in SQL.
    expect(parseSetting("date", "2026-10-17", "Deadline")).toBe("2026-10-17");
    expect(() => parseSetting("date", "17 October", "Deadline")).toThrow(/choose a date/);
  });

  it("reads a checkbox", () => {
    expect(parseSetting("bool", "1", "Switch")).toBe(true);
    expect(parseSetting("bool", "", "Switch")).toBe(false);
  });

  it("keeps text as text, including empty", () => {
    expect(parseSetting("text", "  HIBISCUS  ", "Sender")).toBe("HIBISCUS");
    expect(parseSetting("text", "", "Sender")).toBe("");
  });
});

describe("formatSetting", () => {
  it("shows a stored value the way the box takes it back", () => {
    // Round-tripping is the property that matters: what the page shows must
    // parse back to what was stored, or saving an untouched form changes it.
    expect(formatSetting("timeList", [480, 630])).toBe("08:00, 10:30");
    expect(parseSetting("timeList", formatSetting("timeList", [480, 630]), "x")).toEqual([480, 630]);
    expect(formatSetting("intList", [7, 2])).toBe("7, 2");
    expect(parseSetting("intList", formatSetting("intList", [7, 2]), "x")).toEqual([7, 2]);
    expect(formatSetting("bool", true)).toBe("1");
    expect(formatSetting("bool", false)).toBe("");
    expect(formatSetting("date", "2026-10-17")).toBe("2026-10-17");
    expect(formatSetting("int", 14)).toBe("14");
    expect(formatSetting("hour", 0)).toBe("0");
  });
});
