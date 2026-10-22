import { describe, expect, it } from "vitest";
import type { ApplicationGraph } from "@/lib/applications";
import type { AdminClient } from "@/lib/supabase/admin";
import type { PromotionRow } from "@/lib/supabase/types";
import { codedPromotionLive, promotionForCode, resolvePromotion } from "@/lib/promotions/load";

/**
 * A staff discount (`DISCOUNT-5`, 20 October 2026) and a scholarship band
 * (`SCHOLARSHIP-10` to `SCHOLARSHIP-50`) are given by staff and never by a
 * code a parent types: otherwise anybody who learned the code could give
 * themselves 5% off, or half their tuition with both fees waived. The enquiry
 * form asks `promotionForCode`, so that is where it is refused; the offer asks
 * `resolvePromotion`, which refuses it again for a code that reached
 * `applications.promo_code` some other way. Nor does a staff-only code make
 * the form show its code box (`codedPromotionLive`).
 *
 * The doubles answer every promotion lookup with a live row carrying the code
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

const STAFF_ONLY = ["DISCOUNT-5", "discount-5", " Discount-5 ", "SCHOLARSHIP-50", "scholarship-10", " Scholarship-30 "];

describe("promotionForCode", () => {
  it("does not recognise a staff discount or a scholarship typed by a parent, however it is typed", async () => {
    for (const typed of STAFF_ONLY) {
      expect(await promotionForCode(stub(), typed), typed).toBeNull();
    }
  });

  it("still recognises an ordinary deal's code", async () => {
    expect((await promotionForCode(stub(), "launch2027"))?.code).toBe("LAUNCH2027");
  });
});

function promotion(code: string): PromotionRow {
  return {
    id: `promo-${code}`,
    code,
    name: code,
    letter_text: null,
    campus_id: null,
    academic_year_id: null,
    grade_sort_min: null,
    grade_sort_max: null,
    entry_route: null,
    heard_from: null,
    starts_on: null,
    ends_on: null,
    max_redemptions: null,
    is_active: true,
    created_by: null,
    created_at: "2026-09-22T00:00:00Z",
    updated_at: "2026-09-22T00:00:00Z",
  };
}

/**
 * An application with nothing on file yet, and every one of `promotions` live,
 * unscoped and never redeemed. What `resolvePromotion` writes is kept in
 * `recorded`.
 */
function database(promotions: PromotionRow[]) {
  const recorded: { promotion_id: string; source: string }[] = [];
  const from = (table: string) => {
    const eqs: Record<string, unknown> = {};
    const answer = () => {
      if (table === "application_promotions") return { data: null, count: 0, error: null };
      if (table === "promotion_effects") return { data: [], error: null };
      if ("id" in eqs) return { data: promotions.find((p) => p.id === eqs.id) ?? null, error: null };
      return { data: promotions, error: null };
    };
    const q = {
      select: () => q,
      eq: (column: string, value: unknown) => {
        eqs[column] = value;
        return q;
      },
      order: () => q,
      maybeSingle: async () => answer(),
      upsert: async (row: { promotion_id: string; source: string }) => {
        recorded.push(row);
        return { error: null };
      },
      then: (resolve: (value: unknown) => void) => resolve(answer()),
    };
    return q;
  };
  return { admin: { from } as unknown as AdminClient, recorded };
}

function graphWithCode(promoCode: string): ApplicationGraph {
  return {
    application: { id: "app-1", campus_id: "campus-1", entry_route: "assessment", heard_from: null, promo_code: promoCode },
    intake: { academic_year_id: "year-2027" },
    grade: { sort_order: 5 },
  } as unknown as ApplicationGraph;
}

describe("resolvePromotion", () => {
  it("never attaches a staff discount or a scholarship from the code on the application", async () => {
    const live = ["DISCOUNT-5", "SCHOLARSHIP-10", "SCHOLARSHIP-30", "SCHOLARSHIP-50"].map(promotion);
    for (const typed of STAFF_ONLY) {
      const db = database(live);
      expect(await resolvePromotion(db.admin, graphWithCode(typed)), typed).toBeNull();
      expect(db.recorded, typed).toEqual([]);
    }
  });

  it("still attaches an ordinary deal's code", async () => {
    const db = database([promotion("LAUNCH2027")]);
    const resolved = await resolvePromotion(db.admin, graphWithCode("launch2027"));
    expect(resolved?.source).toBe("code");
    expect(resolved?.promo.code).toBe("LAUNCH2027");
    expect(db.recorded).toMatchObject([{ promotion_id: "promo-LAUNCH2027", source: "code" }]);
  });
});

/** Every one of `codes` live today, as the form's question sees them. */
function liveCodes(codes: string[]): AdminClient {
  const q = {
    select: () => q,
    eq: () => q,
    not: () => q,
    then: (resolve: (value: unknown) => void) => resolve({ data: codes.map((code) => ({ code, starts_on: null, ends_on: null })), error: null }),
  };
  return { from: () => q } as unknown as AdminClient;
}

describe("codedPromotionLive", () => {
  it("does not ask for a code when only staff-only codes are live", async () => {
    expect(await codedPromotionLive(liveCodes(["DISCOUNT-5", "SCHOLARSHIP-10", "SCHOLARSHIP-50"]))).toBe(false);
  });

  it("asks for a code when a family may type one", async () => {
    expect(await codedPromotionLive(liveCodes(["DISCOUNT-5", "SCHOLARSHIP-50", "LAUNCH2027"]))).toBe(true);
  });
});
