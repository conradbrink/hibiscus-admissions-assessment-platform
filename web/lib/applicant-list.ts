import type { SupabaseClient } from "@supabase/supabase-js";
import type { FactRow } from "@/lib/analytics/breakdown";
import { DIMENSION_LABELS } from "@/lib/analytics/breakdown";
import { drillFrom, drillRows, drillTitle, groupLabel, type Drill } from "@/lib/analytics/drill-down";
import { readFacts } from "@/lib/analytics/facts";
import { resolveRange } from "@/lib/analytics/ranges";
import { formatDate, formatDateRange, formatTime, schoolDaysBetween, toSchoolDateString } from "@/lib/format-date";
import { isScholarshipCode } from "@/lib/promotions/scholarship";
import { formatMonth, startLabel } from "@/lib/start-month";
import { FLAG_LABELS, type Flag } from "@/lib/summary/facts";
import type { ApplicationStatus, Database } from "@/lib/supabase/types";
import { isNextAction, nextActionCopy, PIPELINE_GROUPS, STATUS_LABELS } from "@/lib/workflow/states";
import { isStageKey, STAGES } from "@/lib/workflow/stages";

/**
 * The applicant list, as one reading shared by the page and its Excel and PDF
 * downloads: which applicants a query string names, the query that reads
 * them, and each one as the line both draw. A file that disagreed with the
 * screen it was taken from would be a report nobody could trust, so neither
 * keeps a copy of the filters or the columns.
 */

type Client = SupabaseClient<Database>;

export type ListSearch = {
  q?: string;
  status?: string;
  /** One of the Admissions stages, from the stage bar. */
  stage?: string;
  /** The board's old column names, from before the stages: still honoured for a bookmark. */
  group?: string;
  campus?: string;
  /** `applications.intake_id` — the term a child is starting. */
  intake?: string;
  /** `applications.start_month`, for the campuses that take children monthly. */
  month?: string;
  mine?: string;
  page?: string;
  /** From the dashboard: only enquiries older than this ("48h"), the ones its count calls not booked. */
  waiting?: string;
  /**
   * The instant `waiting` was worked out from when the list was drawn, carried
   * into its downloads so a file taken an hour later holds the same families
   * as the screen it was taken from.
   */
  waiting_before?: string;
  /** From the dashboard: deferred families due back on or before this date. */
  due_by?: string;
  /**
   * From analytics: the families a conversion step has not converted, among
   * those who enquired between `from` and `to`. Exactly the count analytics
   * showed beside the link.
   */
  step?: string;
  /** From analytics: the families a figure counted (`offered`, `approved`…), likewise. */
  reached?: string;
  /** From analytics: one breakdown group, as a dimension (`grade`) and its value. */
  by?: string;
  value?: string;
  from?: string;
  to?: string;
  /** The analytics breakdown a drill came from, so Back to analytics opens it again. */
  dim?: string;
};

/** The dashboard's narrowings, by what its count is: the list has to hold the same families. */
const WAITING: Record<string, { ms: number; words: string }> = {
  "48h": { ms: 48 * 3_600_000, words: "who enquired more than 48 hours ago" },
};

export type ListFilters = {
  stage: (typeof STAGES)[number] | undefined;
  group: (typeof PIPELINE_GROUPS)[number] | undefined;
  /** Null for every status but withdrawn. */
  statuses: ApplicationStatus[] | null;
  status: ApplicationStatus | undefined;
  waiting: { words: string; before: string } | undefined;
  dueBy: string | undefined;
  /** From analytics, with the period it is about. The other filters stand aside while it is on. */
  drill: Drill | null;
  range: { from: string; to: string } | null;
  campus: string | undefined;
  intake: string | undefined;
  month: string | undefined;
  mine: boolean;
  q: string | undefined;
};

export function listFilters(sp: ListSearch, now: Date): ListFilters {
  const stage = isStageKey(sp.stage) ? STAGES.find((st) => st.key === sp.stage)! : undefined;
  const group = stage ? undefined : PIPELINE_GROUPS.find((g) => g.key === sp.group);
  const scope = stage ?? group;
  const status = sp.status && Object.hasOwn(STATUS_LABELS, sp.status) ? (sp.status as ApplicationStatus) : undefined;
  const drill = drillFrom(sp);
  return {
    stage,
    group,
    statuses: status ? [status] : scope ? [...scope.statuses] : null,
    status,
    waiting:
      sp.waiting && Object.hasOwn(WAITING, sp.waiting)
        ? { words: WAITING[sp.waiting].words, before: waitingBefore(sp.waiting_before) ?? new Date(now.getTime() - WAITING[sp.waiting].ms).toISOString() }
        : undefined,
    dueBy: sp.due_by && /^\d{4}-\d{2}-\d{2}$/.test(sp.due_by) ? sp.due_by : undefined,
    drill,
    range: drill ? resolveRange(sp.from, sp.to, now) : null,
    campus: sp.campus || undefined,
    intake: sp.intake || undefined,
    month: sp.month || undefined,
    mine: sp.mine === "1",
    // The search goes into a PostgREST `or` filter, where a comma starts a
    // new condition and brackets group them. Nobody's name or reference
    // needs either, so they are read as spaces rather than as syntax.
    q: sp.q?.replace(/[,()]/g, " ").trim() || undefined,
  };
}

/** A carried `waiting_before`, only if it is an instant; anything else is worked out afresh. */
function waitingBefore(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The columns the list and its downloads read; one string, as postgrest-js needs it to type the rows. */
const LIST_SELECT =
  "id, reference, child_first_name, child_last_name, status, next_action, next_action_due_at, created_at, owner_staff_id, requires_assessment, start_month, campuses(name), grades!applications_grade_id_fkey(name), intakes!applications_intake_id_fkey(label), contacts!applications_contact_id_fkey(first_name, last_name, email, families!contacts_family_id_fkey(last_contact_at)), staff_profiles!applications_owner_staff_id_fkey(full_name)";

/**
 * The applicants the filters name, newest enquiry first, before any page is
 * taken. With a drill on, the caller narrows this to the drill's ids instead
 * (`.in("id", …)`), and the other filters stand aside: anything they removed
 * would make the list disagree with the number that was clicked.
 */
export function listQuery(supabase: Client, f: ListFilters, userId: string, opts: { count?: boolean } = {}) {
  let query = supabase
    .from("applications")
    .select(LIST_SELECT, { count: opts.count ? "exact" : undefined })
    .order("created_at", { ascending: false })
    // A tie in time goes by id, so reading the list a page at a time (as the
    // downloads do) never takes the same applicant twice or misses one.
    .order("id", { ascending: true });
  if (f.drill) return query;
  if (f.statuses) query = query.in("status", f.statuses);
  else query = query.neq("status", "withdrawn");
  if (f.waiting) query = query.lt("created_at", f.waiting.before);
  if (f.dueBy) query = query.lte("deferred_until", f.dueBy);
  if (f.campus) query = query.eq("campus_id", f.campus);
  // Term and month compose rather than exclude each other: a campus that takes
  // children monthly still has them on a term, so "Term 1, 2027" and "March
  // 2027" together is a question somebody asks.
  if (f.intake) query = query.eq("intake_id", f.intake);
  if (f.month) query = query.eq("start_month", f.month);
  if (f.mine) query = query.eq("owner_staff_id", userId);
  if (f.q) query = query.or(`reference.ilike.%${f.q}%,child_first_name.ilike.%${f.q}%,child_last_name.ilike.%${f.q}%`);
  return query;
}

export type ListRow = NonNullable<Awaited<ReturnType<typeof listQuery>>["data"]>[number];

/**
 * A drill's families from the same facts analytics counted, every one of
 * them in the list's order, and the facts themselves (for the group's name).
 * `cut` is how many enquiries in the period the read left out, when the cap
 * or the server's row limit stopped it short: analytics' own figure is short
 * by the same rows, so the list still matches it, but neither is the whole
 * period and the list says so.
 */
export async function readDrill(supabase: Client, f: ListFilters): Promise<{ ids: string[]; facts: FactRow[]; cut: number }> {
  if (!f.drill || !f.range) return { ids: [], facts: [], cut: 0 };
  const { data, error, count } = await readFacts(supabase, f.range, f.campus, { count: true });
  if (error) throw new Error(error.message);
  const facts = (data ?? []) as FactRow[];
  return { ids: drillRows(facts, f.drill).map((r) => r.application_id), facts, cut: Math.max(0, (count ?? facts.length) - facts.length) };
}

/** What a row needs beyond itself: the summary's attention flags, and whether the child holds a scholarship. */
export type ListExtras = { flags: Map<string, Flag[]>; scholars: Set<string> };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Read in slices: an id list goes into the request's URL, and a few thousand
 * of them would be longer than a URL can be.
 */
const ID_SLICE = 100;

export function slices<T>(items: readonly T[], size = ID_SLICE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * `work` over every item, a few at a time: one after another, fifty slices of
 * a large download were fifty round trips end to end; all at once, they would
 * be fifty requests landing on the database together.
 */
export async function inParallel<T, R>(items: readonly T[], work: (item: T) => Promise<R>, width = 4): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += width) out.push(...(await Promise.all(items.slice(i, i + width).map(work))));
  return out;
}

/**
 * Attention flags from the last generated summary, where one exists, and
 * which of these children hold a scholarship — batched together, because a
 * row that says "Parent to book assessment" against a scholarship child is
 * the same wrong word the parent's own screen used to show.
 */
export async function loadListExtras(supabase: Client, ids: readonly string[]): Promise<ListExtras> {
  const flags = new Map<string, Flag[]>();
  const scholars = new Set<string>();
  // A failed read is an error, not an empty answer: without it every row would
  // lose its flags, and a scholarship child would be told to book.
  const parts = await inParallel(slices(ids), async (part) => {
    const [summaries, awards] = await Promise.all([
      supabase.from("application_summaries").select("application_id, flags").in("application_id", part),
      supabase.from("application_promotions").select("application_id, promotions(code)").in("application_id", part),
    ]);
    if (summaries.error) throw new Error(summaries.error.message);
    if (awards.error) throw new Error(awards.error.message);
    return { summaries: summaries.data ?? [], awards: awards.data ?? [] };
  });
  for (const { summaries, awards } of parts) {
    for (const s of summaries) flags.set(s.application_id, (Array.isArray(s.flags) ? s.flags : []) as unknown as Flag[]);
    for (const a of awards) if (isScholarshipCode(one(a.promotions)?.code ?? null)) scholars.add(a.application_id);
  }
  return { flags, scholars };
}

/** One applicant as the list and its downloads show them. */
export type ApplicantLine = {
  id: string;
  reference: string;
  childFirstName: string;
  childLastName: string;
  parentName: string;
  parentEmail: string;
  campus: string;
  grade: string;
  /** The month where the campus takes children monthly, the term otherwise. */
  starting: string;
  /** The term too, under a month, as the applicant page shows it. */
  term: string | null;
  status: ApplicationStatus;
  statusLabel: string;
  /** What needs somebody's attention, from the summary; "waiting on the school" is the next action's to say. */
  attention: string[];
  nextAction: string;
  nextActionDueAt: string | null;
  owner: string | null;
  /**
   * When the school and the family last spoke: the CRM's "Last contact",
   * one date for the family whichever child it is about. Moved by every
   * email and WhatsApp either way, automatic ones included, and by Log
   * contact (a call, a conversation at the desk) on the family's CRM page.
   */
  lastContactAt: string | null;
  enquiredAt: string;
};

export function toLine(r: ListRow, extras: ListExtras): ApplicantLine {
  const contact = one(r.contacts);
  const intake = one(r.intakes);
  return {
    id: r.id,
    reference: r.reference,
    childFirstName: r.child_first_name,
    childLastName: r.child_last_name,
    parentName: [contact?.first_name, contact?.last_name].filter(Boolean).join(" "),
    parentEmail: contact?.email ?? "",
    campus: one(r.campuses)?.name ?? "",
    grade: one(r.grades)?.name ?? "",
    // The same answer the applicant page and the offer letter give, from the same helper.
    starting: intake ? startLabel(r, intake) : "—",
    term: r.start_month && intake ? intake.label : null,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] ?? r.status,
    attention: (extras.flags.get(r.id) ?? []).filter((fl) => fl.kind !== "waiting_on_school").map((fl) => FLAG_LABELS[fl.kind] ?? fl.kind),
    nextAction: isNextAction(r.next_action)
      ? nextActionCopy(r.next_action, { requiresAssessment: r.requires_assessment, bookingKind: null, scholarship: extras.scholars.has(r.id) }).staffLabel
      : "—",
    nextActionDueAt: r.next_action_due_at,
    owner: one(r.staff_profiles)?.full_name ?? null,
    lastContactAt: one(contact?.families ?? null)?.last_contact_at ?? null,
    enquiredAt: r.created_at,
  };
}

/** The names a description needs that the query string carries only as ids. */
export type ListNames = {
  campus?: string | null;
  intake?: string | null;
  facts?: readonly FactRow[];
  /** Enquiries in the period the drill's read left out (`readDrill`). */
  cut?: number;
};

/**
 * What the list holds, in words: the line under a download's title, and the
 * sentence over a list opened from analytics. Every filter that narrowed it
 * is named, so a file read a week later still says what it is of.
 */
export function describeList(f: ListFilters, names: ListNames = {}): string {
  if (f.drill && f.range) {
    const group = f.drill.group ? ` · ${DIMENSION_LABELS[f.drill.group.dim]}: ${groupLabel(names.facts ?? [], f.drill.group)}` : "";
    const short = names.cut ? ` (from the first ${names.facts?.length ?? 0} enquiries only: ${names.cut} more could not be read, so choose a shorter period)` : "";
    return `${drillTitle(f.drill)}, from families who enquired ${formatDateRange(f.range.from, f.range.to)}${names.campus ? ` at ${names.campus}` : ""}${group}${short}`;
  }
  const parts = [
    f.status ? STATUS_LABELS[f.status] : f.stage ? `${f.stage.label} stage` : f.group ? f.group.label : "Every applicant still in play",
    names.campus ? `at ${names.campus}` : null,
    names.intake ? `starting ${names.intake}` : null,
    f.month ? `starting ${formatMonth(f.month)}` : null,
    f.waiting ? f.waiting.words : null,
    f.dueBy ? `due back by ${formatDate(f.dueBy)}` : null,
    f.mine ? "owned by me" : null,
    f.q ? `matching "${f.q}"` : null,
  ];
  return parts.filter(Boolean).join(", ");
}

/** The spreadsheet's columns: what the list shows, with names split so they sort. */
export const SHEET_HEADERS = [
  "Reference",
  "Child first name",
  "Child last name",
  "Parent",
  "Parent email",
  "Campus",
  "Grade",
  "Starting",
  "Status",
  "Needs attention",
  "Next action",
  "Next action due",
  "Owner",
  "Last contacted",
  "Enquired",
] as const;

/**
 * A line as spreadsheet cells. Dates are written `YYYY-MM-DD` in the school's
 * time so they sort as text, which is what every cell in the workbook is
 * (see `lib/enrolment/xlsx.ts` on why nothing is left for Excel to guess).
 */
export function sheetCells(l: ApplicantLine): string[] {
  const due = l.nextActionDueAt ? `${toSchoolDateString(new Date(l.nextActionDueAt))} ${formatTime(l.nextActionDueAt)}` : "";
  return [
    l.reference,
    l.childFirstName,
    l.childLastName,
    l.parentName,
    l.parentEmail,
    l.campus,
    l.grade,
    l.term ? `${l.starting} (${l.term})` : l.starting,
    l.statusLabel,
    l.attention.join("; "),
    l.nextAction,
    due,
    l.owner ?? "",
    l.lastContactAt ? toSchoolDateString(new Date(l.lastContactAt)) : "Never",
    toSchoolDateString(new Date(l.enquiredAt)),
  ];
}

/** A fortnight without a word is when a family is worth a call; the list marks it. */
export const QUIET_DAYS = 14;

/**
 * How long since the school and the family last spoke, as a manager asks
 * it: "today", "3 days ago", "never". `quiet` once it has been a fortnight
 * or more, or never, so the families nobody has spoken to stand out.
 */
export function contactAge(iso: string | null, now: Date): { words: string; quiet: boolean } {
  // Calendar days in the school's zone, as the date printed under it reads.
  const days = iso ? schoolDaysBetween(iso, now) : null;
  if (days === null) return { words: "Never", quiet: true };
  const words = days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
  return { words, quiet: days >= QUIET_DAYS };
}

/**
 * A download's name: what it is of and the day it was taken, so two files
 * saved side by side ("offered", "enrolment-stage") are told apart without
 * being opened.
 */
export function listFilename(f: ListFilters, ext: "xlsx" | "pdf", now: Date): string {
  const what = f.drill
    ? [f.drill.step ?? f.drill.figure ?? "enquiries", f.drill.group?.dim].filter(Boolean).join("-")
    : f.status ?? (f.stage ? `${f.stage.key}-stage` : f.group?.key ?? "all");
  const slug = what.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  return `hibiscus-applicants-${slug}-${toSchoolDateString(now)}.${ext}`;
}
