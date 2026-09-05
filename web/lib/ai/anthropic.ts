import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AiProvider } from "@/lib/ai/provider";

/**
 * Claude, through the official SDK, with structured output: the response
 * is parsed against the caller's schema by the SDK, so "the model returned
 * something that is not the shape we asked for" is a result, never an
 * exception in the caller.
 *
 * A refusal is a result too. The safety classifiers can decline a request;
 * the caller falls back to deterministic wording, which is the behaviour we
 * want for a document a parent reads.
 */

const DEFAULT_MODEL = "claude-opus-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
    client = new Anthropic();
  }
  return client;
}

export const anthropicProvider: AiProvider = {
  name: "anthropic",
  async generateStructured(request) {
    const model = process.env.AI_MODEL ?? DEFAULT_MODEL;
    try {
      // Attachments go first as document/image blocks, then the instructions
      // as text, which is the order the API reads best.
      const content: Anthropic.Messages.ContentBlockParam[] = [];
      for (const a of request.attachments ?? []) {
        const data = Buffer.from(a.bytes).toString("base64");
        if (a.mime === "application/pdf") {
          content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data }, ...(a.title ? { title: a.title } : {}) });
        } else {
          content.push({ type: "image", source: { type: "base64", media_type: a.mime, data } });
        }
      }
      content.push({ type: "text", text: request.input });
      const response = await getClient().messages.parse({
        model,
        max_tokens: request.maxTokens ?? 8000,
        system: request.system,
        messages: [{ role: "user", content }],
        output_config: { format: zodOutputFormat(request.schema) },
      });
      if (response.stop_reason === "refusal") {
        return { ok: false, reason: "refused", error: response.stop_details?.explanation ?? "refused", retryable: false };
      }
      if (response.stop_reason === "max_tokens") {
        return { ok: false, reason: "invalid", error: "output truncated", retryable: false };
      }
      const output = response.parsed_output;
      if (output === null || output === undefined) {
        return { ok: false, reason: "invalid", error: "no parseable output", retryable: false };
      }
      return { ok: true, output, model: response.model };
    } catch (e) {
      // Most specific first: the SDK's typed errors say whether a retry can help.
      if (e instanceof Anthropic.RateLimitError) return { ok: false, reason: "error", error: e.message, retryable: true };
      if (e instanceof Anthropic.InternalServerError) return { ok: false, reason: "error", error: e.message, retryable: true };
      if (e instanceof Anthropic.APIConnectionError) return { ok: false, reason: "error", error: e.message, retryable: true };
      if (e instanceof Anthropic.APIError) return { ok: false, reason: "error", error: `${e.status}: ${e.message}`, retryable: false };
      return { ok: false, reason: "error", error: (e as Error).message, retryable: false };
    }
  },
};
