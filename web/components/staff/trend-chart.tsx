/**
 * Enquiries and enrolments per week, as two small bar charts one above the
 * other: the same scale (counts), so a shared baseline and no dual axis; a
 * single series each, so no legend; one hue each, the reference palette's
 * first two categorical slots, stepped for light and dark. Every bar has a
 * hover title; the maximum in each chart is labelled directly; the
 * breakdown table beside the chart is the table view.
 */
export function TrendChart({ series }: { series: Array<{ week: string; enquiries: number; enrolments: number }> }) {
  if (series.length === 0) return null;
  const width = 640;
  const height = 96;
  const pad = { left: 28, right: 8, top: 14, bottom: 18 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = series.length;
  const slot = innerW / n;
  const barW = Math.max(2, slot - 2);

  const panel = (key: "enquiries" | "enrolments", label: string, color: string) => {
    const max = Math.max(1, ...series.map((s) => s[key]));
    const maxIndex = series.findIndex((s) => s[key] === max);
    const ticks = [0, Math.ceil(max / 2), max];
    return (
      <figure className="min-w-0">
        <figcaption className="text-xs font-medium text-muted-foreground">{label} per week</figcaption>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label={`${label} per week, ${n} weeks`}>
          {ticks.map((t) => {
            const y = pad.top + innerH - (t / max) * innerH;
            return (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                <text x={pad.left - 4} y={y + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.6}>{t}</text>
              </g>
            );
          })}
          {series.map((s, i) => {
            const v = s[key];
            const h = (v / max) * innerH;
            const x = pad.left + i * slot + 1;
            const y = pad.top + innerH - h;
            return (
              <g key={s.week}>
                <rect x={x} y={y} width={barW} height={h} rx={Math.min(4, barW / 2)} ry={Math.min(4, barW / 2)} fill={color} />
                {h > 0 ? <rect x={x} y={pad.top + innerH - Math.min(h, 4)} width={barW} height={Math.min(h, 4)} fill={color} /> : null}
                <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent">
                  <title>{`Week of ${s.week}: ${v} ${label.toLowerCase()}`}</title>
                </rect>
                {i === maxIndex && v > 0 ? (
                  <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill="currentColor">{v}</text>
                ) : null}
              </g>
            );
          })}
          <text x={pad.left} y={height - 4} fontSize={9} fill="currentColor" fillOpacity={0.6}>{series[0].week}</text>
          <text x={width - pad.right} y={height - 4} fontSize={9} textAnchor="end" fill="currentColor" fillOpacity={0.6}>{series[n - 1].week}</text>
        </svg>
      </figure>
    );
  };

  return (
    <div className="space-y-3 [--series-1:#2a78d6] [--series-2:#eb6834] dark:[--series-1:#3987e5] dark:[--series-2:#d95926]">
      {panel("enquiries", "Enquiries", "var(--series-1)")}
      {panel("enrolments", "Enrolments", "var(--series-2)")}
    </div>
  );
}
