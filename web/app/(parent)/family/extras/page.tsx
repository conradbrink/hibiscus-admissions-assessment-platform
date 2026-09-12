import type { Metadata } from "next";
import Link from "next/link";
import { ExtraItem } from "@/components/parent/extra-item";
import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";
import { basketTotal, isOrderable, optionsOf, outstandingTotal, type ItemLike } from "@/lib/extras/catalogue";
import { loadFamilyExtras } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { formatDateLong, toSchoolDateString } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { requireFamilySession } from "@/lib/tokens/server";

export const metadata: Metadata = { title: "Extras you can order" };

/**
 * What a family can order alongside a place.
 *
 * Everything here is optional, and the page says so plainly. None of it is
 * ever chased in a reminder and none of it makes a family look behind — the
 * checklist is for what the school needs, this is for what the school offers.
 *
 * Prices are on every row rather than behind a tap: a parent deciding whether
 * to order a stationery pack needs the number in front of them.
 */
export default async function ExtrasPage() {
  const session = await requireFamilySession();
  const today = toSchoolDateString(new Date());
  const children = await loadFamilyExtras(familyClient(), session);

  const anyItems = children.some((c) => c.items.length > 0);

  if (!anyItems) {
    return (
      <PageHeader
        eyebrow="Extras"
        title="There is nothing to order just yet."
        description="When the school opens ordering for stationery, transport, lunch or aftercare, it will appear here."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Extras"
        title="Things you can order"
        description="All of this is optional. Order what you want, leave what you do not — nothing here is needed to start."
      />

      <div className="space-y-8">
        {children.map(({ student, items, selections }) => {
          if (items.length === 0) return null;
          const name = student.preferred_name || student.legal_first_name;
          const basket = basketTotal(selections);
          const owing = outstandingTotal(selections);
          const byItem = new Map(selections.map((s) => [s.item_id, s]));

          return (
            <section key={student.id}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-medium">{name}</h2>
                {basket.lines > 0 && basket.currency ? (
                  <p className="text-sm text-muted-foreground">
                    {basket.lines} ordered ·{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {formatMoney(basket.totalMinor, basket.currency)}
                    </span>
                  </p>
                ) : null}
              </div>

              <ul className="space-y-3">
                {items.map((item) => {
                  const chosen = byItem.get(item.id) ?? null;
                  return (
                    <ExtraItem
                      key={item.id}
                      studentId={student.id}
                      itemId={item.id}
                      label={item.label}
                      description={item.description}
                      price={formatMoney(item.amount_minor, item.currency)}
                      options={optionsOf(item.options)}
                      allowQuantity={item.allow_quantity}
                      orderByLabel={item.order_by ? formatDateLong(item.order_by) : null}
                      orderable={isOrderable(item as unknown as ItemLike, today)}
                      selection={
                        chosen
                          ? { id: chosen.id, quantity: chosen.quantity, choice: chosen.choice, status: chosen.status }
                          : null
                      }
                    />
                  );
                })}
              </ul>

              {/* Only once something is actually outstanding: a Pay button over
                  an empty order can only disappoint. */}
              {owing.lines > 0 && owing.currency ? (
                <div className="mt-3">
                  <Button size="parent" nativeButton={false} render={<Link href={`/family/extras/pay/${student.id}`} />}>
                    Pay for {name}&rsquo;s order — {formatMoney(owing.totalMinor, owing.currency)}
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Order what you want and leave the rest. Nothing here is needed for your child to start, and nothing here is ever chased.
      </p>
    </>
  );
}
