import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * The school's letterhead for every PDF the platform issues: the logo on
 * the left, the document's name and reference on the right, a rule in the
 * brand colour, and a footer with the school's name. One component so the
 * offer, the receipt, the learning profile and the assessment report all
 * look like they came from the same school.
 *
 * The logo is fetched by URL when the document renders (react-pdf reads
 * the image itself), so callers pass the public site URL; when there is
 * none, the school's name stands in.
 */
export const SCHOOL_NAME = "Hibiscus International Schools";
export const BRAND = "#e8632b";

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 10, marginBottom: 14 },
  logo: { width: 110 },
  wordmark: { fontSize: 12, fontFamily: "Helvetica-Bold", color: BRAND, letterSpacing: 1 },
  right: { textAlign: "right", fontSize: 9, color: "#6b7280", lineHeight: 1.35 },
  rightHead: { fontFamily: "Helvetica-Bold", color: "#1f2937" },
  docLine: { fontSize: 8.5, color: "#6b7280", textAlign: "right", marginTop: -8, marginBottom: 10 },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 7.5, color: "#9ca3af", lineHeight: 1.3, paddingRight: 40 },
  pageNo: { position: "absolute", bottom: 24, right: 44, fontSize: 8, color: "#9ca3af" },
});

/** What the letterhead says about the campus the document comes from. */
export type LetterheadCampus = { name: string; descriptor: string | null; address: string | null };

export const SCHOOL_WEBSITE = "www.hibiscusschools.com";

/** The campus block, line by line: the school as this campus calls itself, its address and phone lines, the website. */
export function campusLines(campus: LetterheadCampus): string[] {
  const head = campus.descriptor ? `Hibiscus ${campus.descriptor}` : SCHOOL_NAME;
  const address = (campus.address ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return [head, `${campus.name} Campus`, ...address, SCHOOL_WEBSITE];
}

export function logoUrlFor(siteUrl: string | null | undefined): string | null {
  const base = (siteUrl ?? "").replace(/\/+$/, "");
  return base ? `${base}/brand/hibiscus-logo.png` : null;
}

/**
 * The header, repeated on every page. With a campus, the right-hand block is
 * the campus's own letterhead (as the school's letters carry it) and the
 * document's name and reference sit in a small line under the rule; without
 * one, `lines` take the right-hand block.
 */
export function Letterhead({ logoUrl, lines, campus }: { logoUrl: string | null; lines: string[]; campus?: LetterheadCampus | null }) {
  const right = campus ? campusLines(campus) : lines;
  return (
    <>
      <View style={s.header} fixed>
        {/* react-pdf's Image has no alt prop; the mark is decorative here. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        {logoUrl ? <Image src={logoUrl} style={s.logo} /> : <Text style={s.wordmark}>{SCHOOL_NAME.toUpperCase()}</Text>}
        <View style={s.right}>
          {right.map((l, i) => (
            <Text key={i} style={campus && i === 0 ? s.rightHead : undefined}>{l}</Text>
          ))}
        </View>
      </View>
      {campus && lines.length ? <Text style={s.docLine} fixed>{lines.join(" · ")}</Text> : null}
    </>
  );
}

/** The footer, repeated on every page, with the page number beside it. */
export function LetterFoot({ text }: { text: string }) {
  return (
    <>
      <Text style={s.footer} fixed>{SCHOOL_NAME} · {text}</Text>
      <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </>
  );
}
