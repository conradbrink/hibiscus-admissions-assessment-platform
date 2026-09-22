import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * A runner for the scholarship import, kept out of the ordinary suite.
 *
 * `vitest.config.ts` says what it is for in its first line — pure domain
 * modules, nothing touching Next, React or a database — and the import is all
 * three. Rather than quietly widen that promise, this config exists alongside
 * it and is only ever invoked by hand:
 *
 *   npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * Two differences from the main config. It collects `scripts/` instead of
 * `lib/`, and it stubs `server-only` — a marker package whose whole job is to
 * fail the build if a server module is pulled into a client bundle. There is
 * no bundle here, so the marker has nothing to protect and would only stop the
 * import running at all.
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".."),
      "server-only": path.resolve(__dirname, "server-only-stub.ts"),
    },
  },
});
