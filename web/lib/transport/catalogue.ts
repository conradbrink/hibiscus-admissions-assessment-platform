import "server-only";
import { toSchoolDateString } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import type {
  TransportAreaRow,
  TransportPeriodRow,
  TransportPriceListRow,
  TransportTariffRow,
  TransportZoneRow,
} from "@/lib/supabase/types";

/**
 * What the public transport pages show before anybody has booked: whether
 * booking is open, the periods that can be booked, the areas, the schools and
 * their grades, the prices and the terms.
 *
 * All of it is reference data, read under the service role because the page
 * has no principal, and none of it names a person. The booking function checks
 * every one of these again when the form arrives; this only decides what the
 * page offers.
 */

export type CatalogueCampus = { id: string; name: string; grades: Array<{ id: string; name: string }> };

export type BookingCatalogue = {
  /** Why booking is shut, if it is: the checklist the staff settings page shows too. */
  closedBecause: Array<"switched_off" | "no_period" | "no_terms">;
  officeContact: string;
  /** Who drives: the provider on the open periods' price list. */
  providerName: string | null;
  periods: Array<TransportPeriodRow & { divisor: number }>;
  zones: TransportZoneRow[];
  areas: TransportAreaRow[];
  campuses: CatalogueCampus[];
  priceLists: TransportPriceListRow[];
  tariffs: TransportTariffRow[];
  terms: { id: string; version: number; body_text: string; body_hash: string } | null;
};

/** Which of the periods a parent may book today, by the same rule as the booking function. */
export function bookablePeriods(periods: readonly TransportPeriodRow[], today: string): Array<TransportPeriodRow & { divisor: number }> {
  const terms = new Map(periods.filter((p) => p.kind === "term").map((p) => [p.id, p]));
  return periods
    .filter((p) => p.is_published && p.booking_opens_on <= today && today <= p.booking_closes_on)
    .filter((p) => p.kind === "term" || (p.term_period_id !== null && terms.get(p.term_period_id)?.is_published === true))
    .map((p) => ({ ...p, divisor: p.kind === "month" ? p.billing_months : 1 }))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || (a.kind === "term" ? -1 : 1));
}

export async function loadBookingCatalogue(admin: AdminClient, now: Date = new Date()): Promise<BookingCatalogue> {
  const today = toSchoolDateString(now);
  const settings = await getSettings(admin);

  const [periodsRes, zonesRes, areasRes, campusesRes, gradesRes, termsRes] = await Promise.all([
    admin.from("transport_periods").select("*").eq("is_published", true),
    admin.from("transport_zones").select("*").eq("is_active", true).order("sort_order"),
    admin.from("transport_areas").select("*").eq("is_active", true).order("sort_order").order("name"),
    admin.from("campuses").select("id, name, sort_order").eq("is_active", true).eq("country", "BW").eq("currency", "BWP").order("sort_order"),
    admin.from("campus_grades").select("campus_id, grades!campus_grades_grade_id_fkey(id, name, sort_order)").eq("is_active", true),
    admin.from("transport_terms").select("id, version, body_text, body_hash").not("published_at", "is", null).order("version", { ascending: false }).limit(1),
  ]);
  for (const r of [periodsRes, zonesRes, areasRes, campusesRes, gradesRes, termsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const periods = bookablePeriods(periodsRes.data ?? [], today);
  const listIds = [...new Set(periods.map((p) => p.price_list_id))];
  const [listsRes, tariffsRes] = listIds.length
    ? await Promise.all([
        admin.from("transport_price_lists").select("*, transport_providers!transport_price_lists_provider_id_fkey(name)").in("id", listIds),
        admin.from("transport_tariffs").select("*").in("price_list_id", listIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (listsRes.error) throw new Error(listsRes.error.message);
  if (tariffsRes.error) throw new Error(tariffsRes.error.message);
  const providerOf = (row: { transport_providers?: unknown }) => {
    const p = Array.isArray(row.transport_providers) ? row.transport_providers[0] : row.transport_providers;
    return p && typeof p === "object" && "name" in p ? String((p as { name: string }).name) : null;
  };

  const zones = zonesRes.data ?? [];
  const activeZones = new Set(zones.map((z) => z.id));
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const gradesByCampus = new Map<string, Array<{ id: string; name: string; sort_order: number }>>();
  for (const row of gradesRes.data ?? []) {
    const grade = one(row.grades);
    if (!grade) continue;
    const list = gradesByCampus.get(row.campus_id) ?? [];
    list.push(grade);
    gradesByCampus.set(row.campus_id, list);
  }
  const campuses: CatalogueCampus[] = (campusesRes.data ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      grades: (gradesByCampus.get(c.id) ?? []).sort((a, b) => a.sort_order - b.sort_order).map((g) => ({ id: g.id, name: g.name })),
    }))
    .filter((c) => c.grades.length > 0);

  const terms = termsRes.data?.[0] ?? null;
  const closedBecause: BookingCatalogue["closedBecause"] = [];
  if (!settings.transportBookingEnabled) closedBecause.push("switched_off");
  if (periods.length === 0) closedBecause.push("no_period");
  if (!terms) closedBecause.push("no_terms");

  return {
    closedBecause,
    officeContact: settings.transportOfficeContact,
    providerName: (listsRes.data ?? []).map(providerOf).find((n) => n) ?? null,
    periods,
    zones,
    areas: (areasRes.data ?? []).filter((a) => activeZones.has(a.zone_id)),
    campuses,
    priceLists: (listsRes.data ?? []).map((row) => ({
      id: row.id,
      provider_id: row.provider_id,
      label: row.label,
      currency: row.currency,
      rebate_bp: row.rebate_bp,
      vat_bp: row.vat_bp,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    tariffs: tariffsRes.data ?? [],
    terms,
  };
}
