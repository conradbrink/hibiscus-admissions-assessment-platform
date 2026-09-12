import { describe, expect, it } from "vitest";
import { devShortcutsAllowed, isLocalDevelopment } from "@/lib/deployment";

const env = (v: Record<string, string | undefined>) => v as unknown as NodeJS.ProcessEnv;

/**
 * The distinction these tests exist to keep: "not production" is not the same
 * fact as "not a deployment", and the shortcuts care about the second one.
 */
describe("where the code is running", () => {
  it("calls a machine with no Vercel environment local", () => {
    expect(isLocalDevelopment(env({}))).toBe(true);
    expect(isLocalDevelopment(env({ VERCEL_ENV: "preview" }))).toBe(false);
    expect(isLocalDevelopment(env({ VERCEL_ENV: "production" }))).toBe(false);
  });
});

describe("whether development shortcuts may run", () => {
  it("allows them on a developer's own machine", () => {
    expect(devShortcutsAllowed(env({}))).toBe(true);
    expect(devShortcutsAllowed(env({ NODE_ENV: "production" }))).toBe(true);
  });

  it("refuses them on a preview deployment", () => {
    // This is the finding. PAYMENT_PROVIDER is set for the production
    // environment only, so on a preview build it is unset and defaults to
    // "dev" — and the old test, `VERCEL_ENV !== "production"`, was true. A
    // screen that marks a payment succeeded was live on a URL in a pull
    // request comment, against whatever database that build was pointed at.
    expect(devShortcutsAllowed(env({ VERCEL_ENV: "preview" }))).toBe(false);
  });

  it("refuses them on any other deployment name Vercel invents", () => {
    expect(devShortcutsAllowed(env({ VERCEL_ENV: "staging" }))).toBe(false);
  });

  it("allows them on a deployment only when somebody says so in as many words", () => {
    expect(devShortcutsAllowed(env({ VERCEL_ENV: "preview", ALLOW_DEV_SHORTCUTS: "1" }))).toBe(true);
    // Anything other than the exact opt-in is a no.
    for (const value of ["", "0", "true", "yes", "TRUE"]) {
      expect(devShortcutsAllowed(env({ VERCEL_ENV: "preview", ALLOW_DEV_SHORTCUTS: value }))).toBe(false);
    }
  });

  it("refuses them on production whatever the variables say", () => {
    expect(devShortcutsAllowed(env({ VERCEL_ENV: "production" }))).toBe(false);
    expect(devShortcutsAllowed(env({ VERCEL_ENV: "production", ALLOW_DEV_SHORTCUTS: "1" }))).toBe(false);
  });
});
