import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests for the pure modules under lib/: scoring, tenure, the payroll
// engine, the AI-writing signals, the template renderer, the cookies. Nothing
// here touches Next, React or a database.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // A marker package whose only job is to fail a client bundle; there is
      // no bundle in a unit test.
      "server-only": path.resolve(__dirname, "scripts/server-only-stub.ts"),
    },
  },
});
