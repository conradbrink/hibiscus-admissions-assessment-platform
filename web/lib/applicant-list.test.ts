import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { FactRow } from "@/lib/analytics/breakdown";
import { contactAge, describeList, inParallel, listFilename, listFilters, SHEET_HEADERS, sheetCells, slices, toLine, type ListRow } from "@/lib/applicant-list";
import { ApplicantListDocument, pageSlices, rowHeight } from "@/lib/documents/applicant-list-pdf";
import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { readWorkbook } from "@/lib/xlsx-read";

const NOW = new Date("2026-10-14T10:00:00Z");

function listRow(over: Partial<ListRow> = {}): ListRow {
  return {
    id: "a1",
    reference: "HBS-2026-00042",
    child_first_name: "Naledi",
    child_last_name: "Moeti",
    status: "offer_sent",
    next_action: "review_offer",
    next_action_due_at: "2026-10-20T13:30:00Z",
    created_at: "2026-09-30T23:30:00Z",
    owner_staff_id: null,
    requires_assessment: false,
    start_month: null,
    campuses: { name: "Bana Tlokweng" },
    grades: { name: "Pre-Kindergarten" },
    intakes: { label: "Term 1, 2027" },
    contacts: { first_name: "Kagiso", last_name: "Moeti", email: "k.moeti@example.com", families: { last_contact_at: "2026-10-02T21:00:00Z" } },
    staff_profiles: { full_name: "Conrad Brink" },
    ...over,
  } as ListRow;
}

const NO_EXTRAS = { flags: new Map(), scholars: new Set<string>() };

describe("the applicant list's filters", () => {
  it("reads a figure opened from analytics, with its period, and nothing else", () => {
    const f = listFilters({ reached: "offered", by: "grade", value: "g1", from: "2026-09-14", to: "2026-10-14", campus: "c1", status: "enrolled", q: "x" }, NOW);
    expect(f.drill).toEqual({ step: null, figure: "offered", group: { dim: "grade", key: "g1" } });
    expect(f.range).toEqual({ from: "2026-09-14", to: "2026-10-14" });
    expect(f.campus).toBe("c1");
  });

  it("has no drill and no period for an ordinary list", () => {
    const f = listFilters({ stage: "offer", campus: "c1" }, NOW);
    expect(f.drill).toBeNull();
    expect(f.range).toBeNull();
    expect(f.statuses).toEqual(["approved", "offer_draft", "offer_pending_approval", "offer_sent", "offer_expired", "offer_declined"]);
  });

  it("ignores a status it does not know, rather than asking the database for it", () => {
    expect(listFilters({ status: "toString" }, NOW).statuses).toBeNull();
    expect(listFilters({ status: "paid" }, NOW).statuses).toEqual(["paid"]);
  });

  it("reads a search's commas and brackets as spaces, so they cannot add a condition to the filter", () => {
    expect(listFilters({ q: " Moeti,status.eq.enrolled) " }, NOW).q).toBe("Moeti status.eq.enrolled");
    expect(listFilters({ q: "  " }, NOW).q).toBeUndefined();
  });

  it("turns the dashboard's 48 hours into an instant once, from the clock it was given", () => {
    expect(listFilters({ waiting: "48h" }, NOW).waiting?.before).toBe("2026-10-12T10:00:00.000Z");
    expect(listFilters({ waiting: "forever" }, NOW).waiting).toBeUndefined();
  });

  it("keeps the cut-off the screen worked out, so a download taken later holds the same families", () => {
    expect(listFilters({ waiting: "48h", waiting_before: "2026-10-12T07:00:00.000Z" }, NOW).waiting?.before).toBe("2026-10-12T07:00:00.000Z");
    // Anything that is not an instant is worked out afresh rather than passed to the database.
    expect(listFilters({ waiting: "48h", waiting_before: "yesterday" }, NOW).waiting?.before).toBe("2026-10-12T10:00:00.000Z");
    expect(listFilters({ waiting_before: "2026-10-12T07:00:00.000Z" }, NOW).waiting).toBeUndefined();
  });
});

describe("what a list is of, in words", () => {
  const facts = [{ grade_id: "g1", grade_name: "Pre-Kindergarten" } as FactRow];

  it("names the figure, the period, the campus and the group", () => {
    const f = listFilters({ reached: "offered", by: "grade", value: "g1", from: "2026-09-14", to: "2026-10-14" }, NOW);
    expect(describeList(f, { campus: "Bana Tlokweng", facts })).toBe(
      "Offer sent, from families who enquired 14 Sept to 14 Oct 2026 at Bana Tlokweng · Grade: Pre-Kindergarten"
    );
  });

  it("says so when analytics could not read the whole period", () => {
    const f = listFilters({ reached: "offered", from: "2026-01-01", to: "2026-10-14" }, NOW);
    expect(describeList(f, { facts: Array.from({ length: 1000 }, () => ({}) as FactRow), cut: 240 })).toBe(
      "Offer sent, from families who enquired 1 Jan to 14 Oct 2026 (from the first 1000 enquiries only: 240 more could not be read, so choose a shorter period)"
    );
  });

  it("names a step's families as the step's list does", () => {
    const f = listFilters({ step: "offerToAcceptance", from: "2026-09-14", to: "2026-10-14" }, NOW);
    expect(describeList(f)).toBe("Offers not yet accepted, from families who enquired 14 Sept to 14 Oct 2026");
  });

  it("names every filter of an ordinary list", () => {
    const f = listFilters({ stage: "offer", q: "Moeti", mine: "1" }, NOW);
    expect(describeList(f, { campus: "Block 7", intake: "Term 1, 2027" })).toBe('Offer stage, at Block 7, starting Term 1, 2027, owned by me, matching "Moeti"');
    expect(describeList(listFilters({}, NOW))).toBe("Every applicant still in play");
  });
});

describe("an applicant as a line", () => {
  it("says what the list on screen says", () => {
    const l = toLine(listRow(), { flags: new Map([["a1", [{ kind: "offer_expiring", label: "", evidence: "" }, { kind: "waiting_on_school", label: "", evidence: "" }]]]), scholars: new Set() });
    expect(l).toMatchObject({
      parentName: "Kagiso Moeti",
      campus: "Bana Tlokweng",
      grade: "Pre-Kindergarten",
      starting: "Term 1, 2027",
      term: null,
      statusLabel: "Offer sent",
      // "Waiting on the school" is the next action's to say, as on screen.
      attention: ["Offer expiring"],
      owner: "Conrad Brink",
      lastContactAt: "2026-10-02T21:00:00Z",
    });
  });

  it("has no last contact for a family nobody has written to or logged", () => {
    expect(toLine(listRow({ contacts: { first_name: "A", last_name: "B", email: "a@b.c", families: null } } as Partial<ListRow>), NO_EXTRAS).lastContactAt).toBeNull();
  });

  it("puts the month first and the term under it for a campus that takes children monthly", () => {
    const l = toLine(listRow({ start_month: "2027-03-01" }), NO_EXTRAS);
    expect(l.starting).toBe("March 2027");
    expect(l.term).toBe("Term 1, 2027");
  });

  it("fills every spreadsheet column, with dates in the school's own day", () => {
    const cells = sheetCells(toLine(listRow(), NO_EXTRAS));
    expect(cells).toHaveLength(SHEET_HEADERS.length);
    // 23:30 UTC on the 30th is half past one on the 1st in Gaborone.
    expect(cells[SHEET_HEADERS.indexOf("Enquired")]).toBe("2026-10-01");
    expect(cells[SHEET_HEADERS.indexOf("Next action due")]).toBe("2026-10-20 15:30");
    expect(cells[SHEET_HEADERS.indexOf("Child last name")]).toBe("Moeti");
    // 21:00 UTC on the 2nd is 23:00 the same day in Gaborone.
    expect(cells[SHEET_HEADERS.indexOf("Last contacted")]).toBe("2026-10-02");
    expect(sheetCells({ ...toLine(listRow(), NO_EXTRAS), lastContactAt: null })[SHEET_HEADERS.indexOf("Last contacted")]).toBe("Never");
  });
});

describe("how long since the school and a family last spoke", () => {
  it("reads as a manager would ask it, and marks a fortnight or more", () => {
    expect(contactAge("2026-10-14T08:00:00Z", NOW)).toEqual({ words: "Today", quiet: false });
    // 22:00 on the 13th in Gaborone, read at noon on the 14th: fourteen hours,
    // but yesterday, as the date printed under it says.
    expect(contactAge("2026-10-13T20:00:00Z", NOW)).toEqual({ words: "Yesterday", quiet: false });
    expect(contactAge("2026-10-13T22:30:00Z", NOW)).toEqual({ words: "Today", quiet: false });
    expect(contactAge("2026-10-13T08:00:00Z", NOW)).toEqual({ words: "Yesterday", quiet: false });
    expect(contactAge("2026-10-01T10:00:00Z", NOW)).toEqual({ words: "13 days ago", quiet: false });
    expect(contactAge("2026-09-30T10:00:00Z", NOW)).toEqual({ words: "14 days ago", quiet: true });
    expect(contactAge(null, NOW)).toEqual({ words: "Never", quiet: true });
  });
});

describe("the downloads", () => {
  it("are named for what they hold and the day they were taken", () => {
    expect(listFilename(listFilters({ step: "offerToAcceptance", by: "grade", value: "g1" }, NOW), "xlsx", NOW)).toBe("hibiscus-applicants-offer-to-acceptance-grade-2026-10-14.xlsx");
    expect(listFilename(listFilters({ reached: "noShows" }, NOW), "pdf", NOW)).toBe("hibiscus-applicants-no-shows-2026-10-14.pdf");
    expect(listFilename(listFilters({ stage: "offer" }, NOW), "pdf", NOW)).toBe("hibiscus-applicants-offer-stage-2026-10-14.pdf");
    expect(listFilename(listFilters({}, NOW), "xlsx", NOW)).toBe("hibiscus-applicants-all-2026-10-14.xlsx");
  });

  it("read ids in slices short enough for a URL, a few at a time, in order", async () => {
    expect(slices([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(slices([], 2)).toEqual([]);
    let running = 0;
    let most = 0;
    const out = await inParallel([5, 1, 4, 2, 3, 0], async (n) => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    }, 2);
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(most).toBe(2);
  });

  it("lay the PDF out a page's worth of rows at a time, by height", () => {
    const short = toLine(listRow(), NO_EXTRAS);
    const long = { ...short, parentEmail: "boitumelo.kgosi.family@averyverylongdomainname.co.bw", attention: ["Offer expiring", "Overdue task"] };
    expect(rowHeight(long)).toBeGreaterThan(rowHeight(short));
    const pages = pageSlices([...Array(40).fill(short), ...Array(40).fill(long)]);
    expect(pages.flat()).toHaveLength(80);
    // The first page has the title over it, so it holds fewer.
    expect(pages[0].length).toBeLessThan(pages[1].length);
    // Pages of long rows hold fewer than pages of short ones.
    expect(pages.at(-2)!.length).toBeLessThan(pages[1].length);
    expect(pageSlices([])).toEqual([[]]);
  });

  it("open in a spreadsheet as the same rows", () => {
    const lines = [toLine(listRow(), NO_EXTRAS), toLine(listRow({ id: "a2", reference: "HBS-2026-00043", child_first_name: "Thato" }), NO_EXTRAS)];
    const [sheet] = readWorkbook(buildWorkbook([{ name: "Applicants", headers: SHEET_HEADERS, rows: lines.map(sheetCells) }]));
    expect(sheet.rows[0]).toEqual([...SHEET_HEADERS]);
    expect(sheet.rows.slice(1).map((r) => r[0])).toEqual(["HBS-2026-00042", "HBS-2026-00043"]);
  });

  it("print as a PDF, over several pages, and when the list is empty", async () => {
    const many = Array.from({ length: 120 }, (_, i) => toLine(listRow({ id: `a${i}`, reference: `HBS-2026-${String(i).padStart(5, "0")}` }), NO_EXTRAS));
    for (const lines of [many, []]) {
      const element = createElement(ApplicantListDocument, {
        logoUrl: null,
        description: "Offer sent, from families who enquired 14 Sept to 14 Oct 2026",
        lines,
        total: lines.length + 3,
        generatedAt: NOW.toISOString(),
        generatedBy: "Conrad Brink",
      }) as unknown as ReactElement<DocumentProps>;
      const buffer = await renderToBuffer(element);
      expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
});
