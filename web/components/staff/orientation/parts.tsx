import Link from "next/link";

/**
 * The pieces an orientation screen is built from.
 *
 * Kept deliberately few: a scene, beats inside it, a table of facts, and a
 * rule. Eleven screens written from four shapes read as one document; eleven
 * screens each laid out its own way read as eleven documents.
 */

/** A scene: the slug line, in the screenplay sense, and what happens in it. */
export function Scene({ where, children }: { where: string; children: React.ReactNode }) {
  return (
    <section className="surface mb-4 overflow-hidden">
      <p className="bg-foreground/90 px-4 py-2 text-[11px] font-semibold tracking-[0.12em] text-background uppercase">
        {where}
      </p>
      <div className="divide-y divide-border/70">{children}</div>
    </section>
  );
}

/**
 * One beat of a scene: what is on the screen, what you do, or what to be
 * careful of. The cue is the left-hand column, the way a script names who is
 * speaking before it says what they say.
 */
export function Beat({
  cue,
  tone = "plain",
  children,
}: {
  cue: string;
  tone?: "plain" | "do" | "care";
  children: React.ReactNode;
}) {
  const cueClass =
    tone === "do" ? "text-primary" : tone === "care" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="grid gap-1.5 px-4 py-3.5 text-sm sm:grid-cols-[104px_minmax(0,1fr)] sm:gap-4">
      <p className={`text-[11px] font-semibold tracking-[0.1em] uppercase ${cueClass}`}>{cue}</p>
      <div className="prose prose-sm min-w-0">{children}</div>
    </div>
  );
}

/** A fact table — two columns, because three does not fit a phone. */
export function Facts({
  head,
  rows,
}: {
  head: [string, string];
  rows: ReadonlyArray<readonly [React.ReactNode, React.ReactNode]>;
}) {
  return (
    <div className="mb-4 overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>{head[0]}</th>
            <th>{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="font-medium whitespace-nowrap">{r[0]}</td>
              <td>{r[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Something that does not bend. Five of these, and they are all in act nine. */
export function Rule({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-xl border-l-4 border-destructive/70 bg-destructive/10 px-4 py-3 text-sm">
      <p className="text-[11px] font-semibold tracking-[0.1em] text-destructive uppercase">{n}</p>
      <div className="prose prose-sm mt-1">{children}</div>
    </div>
  );
}

/** A screen name as the reader will see it in the menu. */
export function Where({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-accent px-1.5 py-0.5 text-[0.92em] font-medium text-primary">{children}</span>
  );
}

/** A button as it is labelled in the console. */
export function Press({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-primary px-2 py-0.5 text-[0.85em] font-semibold text-primary-foreground">
      {children}
    </span>
  );
}

/** "Go and look at it now" — the one link a screen offers into the real thing. */
export function GoLook({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-primary underline underline-offset-2">
      {children}
    </Link>
  );
}
