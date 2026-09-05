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
    },
  },
});
