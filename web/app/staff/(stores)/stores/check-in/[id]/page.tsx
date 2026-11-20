import { notFound, redirect } from "next/navigation";
import { PageTitle } from "@/components/staff/page-title";
import { DueBadge } from "@/components/stores/badges";
import { CheckInForm } from "@/components/stores/check-in-form";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { acknowledgements } from "@/lib/stores/data";
import { transactionHref } from "@/lib/stores/links";
import { itemPhotoUrl } from "@/lib/stores/photo";
import { schoolToday } from "@/lib/stores/server";
import { isUuid } from "@/lib/uuid";

export const metadata = { title: "Return equipment" };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await requireStaff("stores.write");
  const [{ data: co }, { data: lines }, ack] = await Promise.all([
    supabase.from("stores_checkouts").select("id, reference, status, employee_name, department_name, checked_out_at, expected_return_date").eq("id", id).maybeSingle(),
    supabase
      .from("stores_checkout_lines")
      .select("id, item_id, item_name, unit, quantity, quantity_returned, quantity_outstanding, stores_items!stores_checkout_lines_item_id_fkey(stores_item_photos(sha256))")
      .eq("checkout_id", id)
      .gt("quantity_outstanding", 0)
      .order("item_name"),
    acknowledgements(supabase),
  ]);
  if (!co) notFound();
  // Nothing left to return: the checkout's own page says so and shows its history.
  if (co.status !== "open" || !lines?.length) redirect(transactionHref("checkout", co.id));
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title={`Return from ${co.employee_name}`} description={`${co.reference}${co.department_name ? ` · ${co.department_name}` : ""} · checked out ${formatDateTime(co.checked_out_at)}`} back={{ href: "/staff/stores/check-in", label: "Check In" }} />
      <div className="mb-4"><DueBadge expected={co.expected_return_date} today={schoolToday()} soonDays={ack.dueSoonDays} /></div>
      <CheckInForm
        checkoutId={co.id}
        reference={co.reference}
        employeeName={co.employee_name}
        acknowledgement={ack.return}
        lines={lines.map((l) => ({
          lineId: l.id,
          itemName: l.item_name,
          unit: l.unit,
          quantity: l.quantity,
          returned: l.quantity_returned,
          outstanding: l.quantity_outstanding,
          photoUrl: itemPhotoUrl(l.item_id, one(one(l.stores_items)?.stores_item_photos)?.sha256),
        }))}
      />
    </div>
  );
}
