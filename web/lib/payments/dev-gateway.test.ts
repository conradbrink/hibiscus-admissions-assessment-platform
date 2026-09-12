import { describe, expect, it } from "vitest";
import { devShortcutsAllowed } from "@/lib/deployment";

/** The exact expression that shipped before, for comparison. */
const oldGuard = (env: Record<string, string | undefined>) =>
  env.VERCEL_ENV !== "production" && (env.PAYMENT_PROVIDER ?? "dev") === "dev";

const newGuard = (env: Record<string, string | undefined>) =>
  devShortcutsAllowed(env as unknown as NodeJS.ProcessEnv) && (env.PAYMENT_PROVIDER ?? "dev") === "dev";

describe("the preview deployment as it is configured today", () => {
  // PAYMENT_PROVIDER is scoped to Production in Vercel, so a preview build
  // sees it unset. This is that environment, exactly.
  const preview = { VERCEL_ENV: "preview", NODE_ENV: "production" };

  it("used to enable the simulated payment gateway", () => {
    expect(oldGuard(preview)).toBe(true);
  });

  it("no longer does", () => {
    expect(newGuard(preview)).toBe(false);
  });

  it("production was and remains refused", () => {
    const prod = { VERCEL_ENV: "production", PAYMENT_PROVIDER: "paygate" };
    expect(oldGuard(prod)).toBe(false);
    expect(newGuard(prod)).toBe(false);
  });

  it("a developer's machine is unaffected", () => {
    expect(oldGuard({})).toBe(true);
    expect(newGuard({})).toBe(true);
  });
});
