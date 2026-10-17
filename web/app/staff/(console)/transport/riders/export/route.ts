import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { formatDateTime, toSchoolDateString } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { auditedWorkbook, refused } from "@/lib/transport/download";
import { ridingPeriodIds } from "@/lib/transport/periods";
import { riderListFilename, riderListSheets } from "@/lib/transport/rider-list";
import { loadAwaitingPayment, loadPeriods, loadProviders, loadStaffRiders, loadTransportSchools } from "@/lib/transport/staff";
import { isRiding } from "@/lib/transport/staff-rider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The rider list the provider plans its routes from, as an Excel workbook:
 * the riders, the seats each run needs, the children taken off since they
 * were paid for, and a sheet saying what the list is and is not.
 *
 * Its own permission, `transport.export`: children's names and home
 * addresses are leaving the school, and the school decides who sends them.
 * The rows are read through the caller's own client, so a campus-scoped
 * coordinator's file holds their own schools' children and says which those
 * are. Every download is written to the audit log first.
 */
export async function GET(request: Request) {
  const ctx = await requireStaff("transport.export");
  // A way of reading the list, not a second door to it.
  if (!can(ctx.permissions, "transport.read")) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const periodId = url.searchParams.get("period") ?? "";
  const now = new Date();

  try {
    const periods = await loadPeriods(ctx.supabase);
    const chosen = periods.find((p) => p.id === periodId);
    if (!chosen) return new Response("Choose a term or month first.\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    const ids = ridingPeriodIds(periods, chosen.id);
    const [riders, awaiting, schools, providers] = await Promise.all([
      loadStaffRiders(ctx.supabase, { periodIds: ids, paidOnly: true }),
      loadAwaitingPayment(ctx.supabase, ids),
      loadTransportSchools(ctx.supabase),
      loadProviders(ctx.supabase),
    ]);
    // A list is one provider's: it is what that provider is sent. One drives
    // today; if a second ever does, the page asks which.
    const present = [...new Set(riders.map((r) => r.booking.providerId))];
    const providerId = url.searchParams.get("provider") ?? (present.length === 1 ? present[0] : providers.find((p) => p.is_active)?.id);
    if (present.length > 1 && !url.searchParams.get("provider")) {
      return new Response("These children are with more than one provider. Choose the provider first.\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const provider = providers.find((p) => p.id === providerId);
    const own = riders.filter((r) => r.booking.providerId === providerId);
    const meta = {
      providerName: provider?.name ?? "The transport provider",
      periodLabel: chosen.label,
      takenAt: formatDateTime(now),
      takenBy: ctx.profile.full_name || ctx.profile.email,
      schools: schools.map((s) => s.name),
      unpaidBookings: awaiting.bookings,
    };
    const sheets = riderListSheets(own, new Map(periods.map((p) => [p.id, p])), meta);
    return await auditedWorkbook(
      ctx,
      {
        action: "transport.riders_exported",
        entityType: "transport_periods",
        entityId: chosen.id,
        after: { period: chosen.label, period_ids: ids, riders: own.filter(isRiding).length, provider: meta.providerName, schools: meta.schools },
      },
      riderListFilename(provider?.code ?? "provider", chosen.label, toSchoolDateString(now)),
      new Uint8Array(buildWorkbook(sheets))
    );
  } catch (e) {
    return refused("The rider list", e);
  }
}
