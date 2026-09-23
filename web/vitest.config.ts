import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests only, for the pure domain modules under lib/: the state machine,
// the token lifecycle, the age-to-grade rule, the template renderer, the rules
// engine. Nothing here touches Next, React or a database — those layers are
// covered by the SQL regression suite and by running the app.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `lib/workflow/actions.ts` is marked `server-only`, a marker package
      // whose whole job is to fail a *client bundle* that pulls a server module
      // into it. There is no bundle here, so it has nothing to protect and
      // would only stop the import running at all — the same reason
      // `scripts/scholarship.vitest.config.ts` stubs it, and the same stub.
      // This does not widen the line above: the workflow tests hand those
      // functions a stub client and still touch no database, Next or React.
      "server-only": path.resolve(__dirname, "scripts/server-only-stub.ts"),
    },
  },
});
