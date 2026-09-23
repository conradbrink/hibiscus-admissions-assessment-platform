import { describe, expect, it } from "vitest";
import { bandCodeIn, classNameForStage, readPrimaryRoster } from "@/lib/scholarship/primary-roster";

/**
 * Fixtures shaped like the real workbook: two blocks with contact columns, one
 * without, side by side on the same rows, with the school's own numbering
 * restarting inside each block.
 */
function sheet(rows: string[][]) {
  return [{ name: "Sheet1", rows }];
}

const BAND_ROW = ["", "50% Scholarship", "", "", "", "", "", "", "", "", "40% Scholarship", "", "", "", "", "", "", "", ""];
const HEADER_ROW = [
  "",
  "Name & Surname", "Stage", "Academics/Sport", "Current School", "Parent Name", "E-mail", "Contact",
  "", "",
  "Name & Surname", "Stage", "Academics / Sports", "Current School", "Parent Name", "E-mail", "Contact",
  "", "",
  "Name & Surname", "Stage", "", "Academics / Sports",
];

describe("classNameForStage", () => {
  it("reads the float a numeric column leaves behind", () => {
    expect(classNameForStage("5.0")).toBe("Stage 5");
    expect(classNameForStage("5")).toBe("Stage 5");
    expect(classNameForStage("7.00")).toBe("Stage 7");
  });

  it("reads a stage somebody typed out", () => {
    expect(classNameForStage("Stage 4")).toBe("Stage 4");
    expect(classNameForStage("stage6")).toBe("Stage 6");
  });

  it("refuses what is not a stage", () => {
    expect(classNameForStage("")).toBeNull();
    expect(classNameForStage("Form 1")).toBeNull();
    expect(classNameForStage("0")).toBeNull();
    expect(classNameForStage("90% Academics")).toBeNull();
  });
});

describe("bandCodeIn", () => {
  it("reads the band out of a block header", () => {
    expect(bandCodeIn("50% Scholarship")).toBe("SCHOLARSHIP-50");
    expect(bandCodeIn("40% Scholarship")).toBe("SCHOLARSHIP-40");
  });

  it("reads the fraction a percentage-formatted column leaves behind", () => {
    expect(bandCodeIn("0.3")).toBe("SCHOLARSHIP-30");
    expect(bandCodeIn(".2")).toBe("SCHOLARSHIP-20");
    expect(bandCodeIn("0.10")).toBe("SCHOLARSHIP-10");
  });

  it("refuses a bare small number, which in this file is a stage", () => {
    // The trap: `30` next to `Stage 6` is how a band column and a stage column
    // look alike. A fraction is unambiguous; a bare integer is not.
    expect(bandCodeIn("30")).toBeNull();
    expect(bandCodeIn("5")).toBeNull();
  });

  it("refuses nothing and nonsense", () => {
    expect(bandCodeIn("")).toBeNull();
    expect(bandCodeIn("0")).toBeNull();
    expect(bandCodeIn("1.5")).toBeNull();
    expect(bandCodeIn("Academics")).toBeNull();
  });
});

describe("readPrimaryRoster", () => {
  it("takes the award from the block, never from the merit column", () => {
    // The whole reason this reader exists. Both children are on a 90% merit
    // note; one holds a 50% award and the other a 40%. Reading the percentage
    // out of the cell beside them would promise both families 90% off.
    const { rows, problems } = readPrimaryRoster(
      sheet([
        BAND_ROW,
        HEADER_ROW,
        [
          "1.0",
          "Aleo Berlin Galeage", "5.0", "90% Academics", "Mafitlhakgosi Primary School",
          "Itumeleng Gofaone Galeage", "gofagaleage@gmail.com", "71735987 / 72954280",
          "", "1.0",
          "Lebopo Nathan Keofitlhile", "5.0", "90% Academics & Sports", "Regent Hill International",
          "Oarabile Foreman Keofitlhile", "vanfore.fk@gmail.com", "7.3143262E7",
        ],
      ])
    );

    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.studentFirstName, r.promotionCode])).toEqual([
      ["Aleo", "SCHOLARSHIP-50"],
      ["Lebopo", "SCHOLARSHIP-40"],
    ]);
  });

  it("reads a family whole, through the shapes a spreadsheet leaves behind", () => {
    const { rows } = readPrimaryRoster(
      sheet([
        BAND_ROW,
        HEADER_ROW,
        ["1.0", "Loapi Boitumelo", "4.0", "90% Academics & Sports", "Regent", "Gorata Lola Nkoane", "lolankoane90@gmail.com", "7.2588876E7"],
      ])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentFirstName: "Loapi",
      studentLastName: "Boitumelo",
      parentFirstName: "Gorata",
      parentLastName: "Lola Nkoane",
      email: "lolankoane90@gmail.com",
      // The float a spreadsheet made of a phone number, put back.
      mobile: "+26772588876",
      className: "Stage 4",
      promotionCode: "SCHOLARSHIP-50",
    });
  });

  it("keeps the first of several numbers and says so", () => {
    const { rows } = readPrimaryRoster(
      sheet([
        BAND_ROW,
        HEADER_ROW,
        ["1.0", "Rhea Gothatamang", "4.0", "90% Academic", "Kgaswe", "Mmaodo Ngwanathebe", "b@example.com", "73565476 / 71565476 / 72647133"],
      ])
    );

    expect(rows[0].mobile).toBe("+26773565476");
    expect(rows[0].notes).toEqual(["other numbers on file: +26771565476, +26772647133"]);
  });

  it("refuses a number that is not a Botswana mobile rather than trimming it to fit", () => {
    // Straight from the file: 7.26000031E8 is 726000031, nine digits. Which
    // digit is the typo is not knowable, and a guessed phone number is worse
    // than a refused row.
    const { rows, problems } = readPrimaryRoster(
      sheet([
        BAND_ROW,
        HEADER_ROW,
        ["8.0", "Mary-Lyn Masire", "6.0", "90% Academics & Sports", "GIS", "Moutlakgola P. Masire", "mout.masire@gmail.com", "7.26000031E8"],
      ])
    );

    expect(rows).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].student).toBe("Mary-Lyn Masire");
    expect(problems[0].why).toContain("is not a Botswana mobile");
  });

  it("refuses a malformed address rather than repairing it", () => {
    const { rows, problems } = readPrimaryRoster(
      sheet([BAND_ROW, HEADER_ROW, ["1.0", "Ranewa Kgomo", "5.0", "90% Academics", "Emerald", "Masilo Kgomo", "masilodkgomo@gmaill", "7.1812621E7"]])
    );

    expect(rows).toEqual([]);
    expect(problems[0].why).toContain("is not a valid address");
  });

  it("holds back a block with no contact columns instead of dropping it", () => {
    const { rows, pending, blocks } = readPrimaryRoster(
      sheet([
        BAND_ROW,
        HEADER_ROW,
        [
          "1.0",
          "Aleo Berlin Galeage", "5.0", "90% Academics", "Mafitlhakgosi", "Itumeleng Galeage", "g@example.com", "71735987",
          "", "",
          "", "", "", "", "", "", "",
          "", "1.0",
          "Tlotla Jaydon Morake", "6.0", "74061929 - 75395609", "0.3",
        ],
      ])
    );

    expect(rows.map((r) => r.studentFirstName)).toEqual(["Aleo"]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      studentName: "Tlotla Jaydon Morake",
      className: "Stage 6",
      // The band is carried per row in these blocks, as the fraction a
      // percentage-formatted column leaves behind.
      promotionCode: "SCHOLARSHIP-30",
      mobile: "+26774061929",
    });
    expect(blocks).toEqual([
      { promotionCode: "SCHOLARSHIP-50", contactable: true, rows: 1 },
      { promotionCode: "SCHOLARSHIP-30", contactable: false, rows: 1 },
    ]);
  });

  it("refuses a headerless block whose rows disagree about the band", () => {
    const { pending, problems } = readPrimaryRoster(
      sheet([
        ["", "", "", ""],
        ["", "Name & Surname", "Stage", "Academics / Sports"],
        ["1.0", "One Child", "4.0", "0.3"],
        ["2.0", "Another Child", "5.0", "0.2"],
      ])
    );

    expect(pending).toEqual([]);
    expect(problems).toHaveLength(2);
    expect(problems[0].why).toContain("do not agree");
  });

  it("finds its columns by label, so adding a column does not shift the read", () => {
    // Tomorrow's file gains parent and email columns in the remaining blocks,
    // which moves everything to their right. Nothing here counts columns.
    const { rows } = readPrimaryRoster(
      sheet([
        ["", "", "", "", "", "", "", "", "", "", "", "30% Scholarship"],
        ["", "Name & Surname", "Stage", "Contact", "", "", "", "", "", "", "", "Name & Surname", "Notes", "Stage", "Parent Name", "E-mail", "Contact"],
        ["1.0", "Ignored Child", "4.0", "71735987", "", "", "", "", "", "", "1.0", "Tlotla Morake", "anything", "6.0", "Neo Morake", "neo@example.com", "74061929"],
      ])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentFirstName: "Tlotla",
      className: "Stage 6",
      promotionCode: "SCHOLARSHIP-30",
      email: "neo@example.com",
      mobile: "+26774061929",
    });
  });

  it("ignores the notes the school wrote down the side of a block", () => {
    const { rows, problems, pending } = readPrimaryRoster(
      sheet([
        BAND_ROW,
        HEADER_ROW,
        ["1.0", "Aleo Galeage", "5.0", "90% Academics", "Mafitlhakgosi", "Itumeleng Galeage", "g@example.com", "71735987"],
        ["", "Scholarship allocation 50%"],
        ["", "Very good academically", "", "Will lift the standard and average in classes."],
        ["", "Additional:", "", "Spelling Bee, Debate, Robotics"],
      ])
    );

    // Those trailing lines put their text in the block's own name column. They
    // carry no row number, so they are not families and not problems either —
    // a report full of "Additional: is not a stage" would bury the one row
    // that genuinely needs a person.
    expect(rows.map((r) => r.studentFirstName)).toEqual(["Aleo"]);
    expect(pending).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("does not read the summary table as families, though it sits in a block's own columns", () => {
    // The sharpest case in the real file. The tally at the bottom occupies
    // columns 30 and 31 — exactly the numbering and name columns of the 10%
    // block — so `0.5 | 12.0` lines up as a child called "12.0" with row
    // number 0.5, and `Summary:` as a child with no number at all.
    const { rows, pending, problems, blocks } = readPrimaryRoster(
      sheet([
        ["", "", "", "", ""],
        ["", "Name & Surname", "Stage", "", "Academics / Sports"],
        ["1.0", "Phemo Kao Ndiye Monnakgosi", "7.0", "7.2846165E7", "0.1"],
        ["2.0", "Sarona Betsi Pule", "7.0", "7.7666663E7", "0.1"],
        ["", "Summary:"],
        ["0.5", "12.0"],
        ["0.4", "14.0"],
        ["", "Total Applications:", "92"],
      ])
    );

    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
    expect(pending.map((p) => p.studentName)).toEqual(["Phemo Kao Ndiye Monnakgosi", "Sarona Betsi Pule"]);
    expect(blocks).toEqual([{ promotionCode: "SCHOLARSHIP-10", contactable: false, rows: 2 }]);
  });
});
