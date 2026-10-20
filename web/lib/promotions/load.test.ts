import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import { promotionForCode } from "@/lib/promotions/load";

/**
 * A staff discount (`DISCOUNT-5`, 20 October 2026) is given by staff on the
 * offer and never by a code a parent types: otherwise anybody who learned
 * the code could give themselves 5% off. The enquiry form asks
 * `promotionForCode`, so that is where it is refused.
 *
 * The double answers every promotion lookup with a live row carrying the code
 * asked for, so the only thing that can say no is the rule under test.
 */
function stub(): AdminClient {
  let code: unknown = null;
  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      if (column === "code") code = value;
      return q;
    },
    maybeSingle: async () => ({ data: { id: "promo-1", code, is_active: true, starts_on: null, ends_on: null }, error: null }),
  };
  return { from: () => q } as unknown as AdminClient;
}

describe("promotionForCode", () => {
  it("does not recognise a staff discount typed by a parent, however it is typed", async () => {
    for (const typed of ["DISCOUNT-5", "discount-5", " Discount-5 "]) {
      expect(await promotionForCode(stub(), typed), typed).toBeNull();
    }
  });

  it("still recognises an ordinary deal's code", async () => {
    expect((await promotionForCode(stub(), "launch2027"))?.code).toBe("LAUNCH2027");
  });
});
