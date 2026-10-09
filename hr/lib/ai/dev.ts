import "server-only";
import type { AiProvider } from "@/lib/ai/provider";

/**
 * Development adapter: returns what the caller said it would, marked as
 * such, so the whole pipeline — validation included — runs with no key.
 */
export const devProvider: AiProvider = {
  name: "dev",
  async generateStructured(request) {
    return { ok: true, output: request.devOutput(), model: "dev" };
  },
};
