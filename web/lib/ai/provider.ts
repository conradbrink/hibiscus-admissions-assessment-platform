import "server-only";
import type { z } from "zod";

/**
 * The one interface every AI use goes through. Two adapters: Anthropic for
 * production and a deterministic one for development, chosen by
 * AI_PROVIDER. Nothing outside lib/ai imports a vendor SDK.
 *
 * Every call is "structured": the caller hands over a Zod schema and gets
 * back either an object that satisfies it or a reason it did not. The
 * caller always has a deterministic fallback and never needs the model to
 * succeed.
 */

export type AiResult<T> =
  | { ok: true; output: T; model: string }
  | { ok: false; reason: "refused" | "disabled" | "invalid" | "error"; error?: string; retryable: boolean };

/** A file the model should read alongside the text: a PDF or a photo of a document. */
export type AiAttachment = {
  mime: "application/pdf" | "image/jpeg" | "image/png";
  bytes: Uint8Array;
  title?: string;
};

export type StructuredRequest<T> = {
  schema: z.ZodType<T>;
  system: string;
  input: string;
  /** Sent before the text, as document or image blocks. The dev adapter ignores them. */
  attachments?: AiAttachment[];
  maxTokens?: number;
  /** What the development adapter returns, so the pipeline runs with no key. */
  devOutput: () => T;
};

export interface AiProvider {
  readonly name: string;
  generateStructured<T>(request: StructuredRequest<T>): Promise<AiResult<T>>;
}

export async function getAiProvider(): Promise<AiProvider> {
  const which = process.env.AI_PROVIDER ?? "dev";
  if (which === "anthropic") {
    const { anthropicProvider } = await import("@/lib/ai/anthropic");
    return anthropicProvider;
  }
  const { devProvider } = await import("@/lib/ai/dev");
  return devProvider;
}
