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
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 7.5, color: "#9ca3af", lineHeight: 1.3, paddingRight: 40 },
  pageNo: { position: "absolute", bottom: 24, right: 44, fontSize: 8, color: "#9ca3af" },
});

export function logoUrlFor(siteUrl: string | null | undefined): string | null {
  const base = (siteUrl ?? "").replace(/\/+$/, "");
  return base ? `${base}/brand/hibiscus-logo.png` : null;
}

/** The header, repeated on every page. `lines` sit on the right: the document's name first, then its reference. */
export function Letterhead({ logoUrl, lines }: { logoUrl: string | null; lines: string[] }) {
  return (
    <View style={s.header} fixed>
      {/* react-pdf's Image has no alt prop; the mark is decorative here. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {logoUrl ? <Image src={logoUrl} style={s.logo} /> : <Text style={s.wordmark}>{SCHOOL_NAME.toUpperCase()}</Text>}
      <View style={s.right}>
        {lines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </View>
    </View>
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
