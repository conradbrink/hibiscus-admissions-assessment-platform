import { describe, expect, it } from "vitest";
import { BATCH_BUDGET_MS, withinBudget } from "@/lib/crm/campaigns/send";

describe("a campaign batch's time budget", () => {
  it("leaves room inside the drain's 60 seconds for its sweeps and the jobs behind it", () => {
    expect(BATCH_BUDGET_MS).toBeLessThanOrEqual(30_000);
  });
  it("takes recipients until the budget is spent, then stops", () => {
    const start = 1_000_000;
    expect(withinBudget(start, start)).toBe(true);
    expect(withinBudget(start, start + BATCH_BUDGET_MS - 1)).toBe(true);
    expect(withinBudget(start, start + BATCH_BUDGET_MS)).toBe(false);
  });
  it("always lets the first recipient through, so a batch cannot end having sent nothing", () => {
    expect(withinBudget(Date.now(), Date.now())).toBe(true);
  });
});
