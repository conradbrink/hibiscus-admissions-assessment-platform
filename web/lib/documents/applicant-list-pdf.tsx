import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { contactAge, type ApplicantLine } from "@/lib/applicant-list";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { LetterFoot, Letterhead, SCHOOL_NAME } from "@/lib/documents/letterhead";

/**
 * An applicant list as a printable report: the list on screen when it was
 * taken, every page of it, with what it is a list of and who took it. For a
 * meeting or a board pack, where a spreadsheet is the wrong thing to hand
 * round. Rendered on demand from the rows; nothing is stored.
 *
 * Landscape, because the list is wide, and the column heads repeat on every
 * page so a sheet read on its own still says what each column is.
 */

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 48, paddingHorizontal: 36, fontSize: 8, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.3 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4, lineHeight: 1.2 },
  what: { fontSize: 9.5, marginBottom: 2, lineHeight: 1.3 },
  meta: { fontSize: 8, color: "#6b7280", marginBottom: 10 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#9ca3af", paddingBottom: 3, marginBottom: 1 },
  headCell: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: "#4b5563", paddingRight: 6 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 3.5 },
  cell: { paddingRight: 6 },
  strong: { fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 7, color: "#6b7280" },
  flag: { fontSize: 7, color: "#b45309" },
  quiet: { color: "#b45309", fontFamily: "Helvetica-Bold" },
  more: { marginTop: 8, fontSize: 8, color: "#6b7280" },
});

/** Relative widths: the table fills the page, and the wordy columns get the room. */
const COLUMNS = [
  { head: "Child", flex: 1.2 },
  { head: "Parent", flex: 1.6 },
  { head: "Campus · Grade", flex: 1.2 },
  { head: "Starting", flex: 0.75 },
  { head: "Status", flex: 1.1 },
  { head: "Next action", flex: 1.2 },
  { head: "Owner", flex: 0.85 },
  { head: "Last contacted", flex: 0.85 },
  { head: "Enquired", flex: 0.7 },
] as const;

export type ApplicantListDocumentProps = {
  logoUrl: string | null;
  /** What the list is of, as the screen said it: `describeList`. */
  description: string;
  lines: readonly ApplicantLine[];
  /** How many the list held; more than `lines` when the download was capped. */
  total: number;
  generatedAt: string;
  generatedBy: string;
};

/**
 * The report is laid out as one page per slice of rows, rather than as one
 * long page left to break itself: react-pdf's time to break a single long
 * page grows with the square of its rows (300 rows took 9s, 1,200 took
 * 112s), while a page that starts with its own rows costs the same whatever
 * came before it.
 *
 * A slice is filled by height, not by count, because a row is two lines or
 * three or four depending on how long the email address and the flags are.
 * The heights are estimates from the column widths below (a character of 7pt
 * Helvetica is about 3.6pt wide), kept on the safe side: an estimate that
 * ran short would spill a row onto a page of its own.
 */
const LINE = 9.6;
const ROW_PADDING = 8;
const PAGE_BUDGET = 400;
const FIRST_PAGE_BUDGET = 330;

/** About how many characters fit on one line of each wrapping column. */
const FITS = { parent: 30, campus: 26, status: 24, next: 26 } as const;

const linesOf = (text: string, fit: number) => (text ? Math.ceil(text.length / fit) : 0);

export function rowHeight(l: ApplicantLine): number {
  const lines = Math.max(
    2,
    linesOf(l.parentName, FITS.parent) + linesOf(l.parentEmail, FITS.parent),
    linesOf([l.campus, l.grade].filter(Boolean).join(" · "), FITS.campus),
    linesOf(l.statusLabel, FITS.status) + linesOf(l.attention.join(" · "), FITS.status),
    linesOf(l.nextAction, FITS.next) + (l.nextActionDueAt ? 1 : 0)
  );
  return lines * LINE + ROW_PADDING;
}

export function pageSlices(lines: readonly ApplicantLine[]): ApplicantLine[][] {
  const out: ApplicantLine[][] = [[]];
  let used = 0;
  for (const l of lines) {
    const h = rowHeight(l);
    const budget = out.length === 1 ? FIRST_PAGE_BUDGET : PAGE_BUDGET;
    if (out[out.length - 1].length && used + h > budget) {
      out.push([]);
      used = 0;
    }
    out[out.length - 1].push(l);
    used += h;
  }
  return out;
}

const cell = (i: number) => [s.cell, { flex: COLUMNS[i].flex }];

function Row({ l, taken }: { l: ApplicantLine; taken: Date }) {
  const age = contactAge(l.lastContactAt, taken);
  return (
    <View style={s.row} wrap={false}>
      <View style={cell(0)}>
        <Text style={s.strong}>{l.childFirstName} {l.childLastName}</Text>
        <Text style={s.sub}>{l.reference}</Text>
      </View>
      <View style={cell(1)}>
        <Text>{l.parentName || "—"}</Text>
        {l.parentEmail ? <Text style={s.sub}>{l.parentEmail}</Text> : null}
      </View>
      <Text style={cell(2)}>{[l.campus, l.grade].filter(Boolean).join(" · ") || "—"}</Text>
      <View style={cell(3)}>
        <Text>{l.starting}</Text>
        {l.term ? <Text style={s.sub}>{l.term}</Text> : null}
      </View>
      <View style={cell(4)}>
        <Text>{l.statusLabel}</Text>
        {l.attention.length ? <Text style={s.flag}>{l.attention.join(" · ")}</Text> : null}
      </View>
      <View style={cell(5)}>
        <Text>{l.nextAction}</Text>
        {l.nextActionDueAt ? <Text style={s.sub}>by {formatDateTime(l.nextActionDueAt)}</Text> : null}
      </View>
      <Text style={cell(6)}>{l.owner ?? "—"}</Text>
      <View style={cell(7)}>
        <Text style={age.quiet ? s.quiet : {}}>{age.words}</Text>
        {l.lastContactAt ? <Text style={s.sub}>{formatDate(l.lastContactAt)}</Text> : null}
      </View>
      <Text style={cell(8)}>{formatDate(l.enquiredAt)}</Text>
    </View>
  );
}

export function ApplicantListDocument(p: ApplicantListDocumentProps) {
  // Ages are as at the moment the list was taken, which the report states.
  const taken = new Date(p.generatedAt);
  const pages = pageSlices(p.lines);
  return (
    <Document title={`Applicants — ${SCHOOL_NAME}`} author={SCHOOL_NAME}>
      {pages.map((rows, i) => (
        <Page key={i} size="A4" orientation="landscape" style={s.page}>
          <Letterhead logoUrl={p.logoUrl} lines={["Applicant list", formatDate(p.generatedAt)]} />
          {i === 0 ? (
            <>
              <Text style={s.title}>Applicants</Text>
              <Text style={s.what}>{p.description}</Text>
              <Text style={s.meta}>
                {p.total === 1 ? "1 applicant" : `${p.total} applicants`}
                {p.lines.length < p.total ? `, the first ${p.lines.length} shown` : ""} · Taken {formatDateTime(p.generatedAt)} by {p.generatedBy}
              </Text>
            </>
          ) : null}
          <View style={s.head} fixed>
            {COLUMNS.map((c, j) => (
              <Text key={c.head} style={[s.headCell, { flex: COLUMNS[j].flex }]}>{c.head}</Text>
            ))}
          </View>
          {p.lines.length === 0 ? <Text style={s.more}>No applicants match.</Text> : null}
          {rows.map((l) => (
            <Row key={l.id} l={l} taken={taken} />
          ))}
          {i === pages.length - 1 && p.lines.length < p.total ? (
            <Text style={s.more}>
              {p.total - p.lines.length} more are not in this file. Narrow the list (a campus, a stage, a shorter period) and download again.
            </Text>
          ) : null}
          <LetterFoot text="Admissions · Applicant list, as it stood when taken. It holds personal information: keep it to the people who need it." />
        </Page>
      ))}
    </Document>
  );
}
