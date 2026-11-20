import "server-only";
import { toSchoolDateString } from "@/lib/format-date";
import { guarded } from "@/lib/staff/action-helpers";
import { isUuid } from "@/lib/uuid";
import { storesErrorMessage } from "@/lib/stores/rules";
import type { Json } from "@/lib/supabase/types";

/**
 * What every Stores server action returns: an error the person can act on, or
 * what was recorded so the screen can say so and move on.
 */
export type StoresActionState = {
  error?: string;
  ok?: boolean;
  id?: string;
  reference?: string;
  /** A one-line confirmation for the screen. */
  message?: string;
  /** For the inline "add an employee": the row the picker should select. */
  employee?: { id: string; full_name: string; department_id: string; department_name: string; employee_number: string | null };
  /** For the inline "new item": the row the picker should select. */
  item?: { id: string; name: string; unit: string; item_type: string; qty_available: number };
};

/**
 * `guarded` from the staff helpers, keeping what the action returned. The
 * same refusals (no permission, second factor owed, sign-in unavailable,
 * validation) are turned into the same sentences, and the database's own
 * sentence comes through as it was raised.
 */
export async function storesGuarded(fn: () => Promise<StoresActionState | void>): Promise<StoresActionState> {
  let out: StoresActionState | void = undefined;
  const result = await guarded(async () => {
    out = await fn();
  });
  return result.error ? { error: result.error } : { ok: true, ...(out ?? {}) };
}

/** The result of an RPC, or its refusal as a sentence for the screen. */
export async function rpcResult<T>(call: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(storesErrorMessage(error));
  return data as T;
}

/** `{ id, reference }` out of a Stores function's jsonb answer. */
export function recorded(data: Json | null): { id: string; reference: string; replayed: boolean } {
  const o = (data ?? {}) as Record<string, unknown>;
  return { id: String(o.id ?? ""), reference: String(o.reference ?? ""), replayed: o.replayed === true };
}

/**
 * The request id the browser chose for this submission. Every Stores write is
 * keyed on it, so a second tap or a retried request returns the first result
 * and moves nothing.
 */
export function requestIdFrom(formData: FormData): string {
  const value = String(formData.get("requestId") ?? "");
  if (!isUuid(value)) throw new Error("This form has expired. Reload the page and try again.");
  return value;
}

/** Today in the school's calendar, for a page that compares dates. */
export function schoolToday(): string {
  return toSchoolDateString(new Date());
}

/** A whole number from a form field, or null. */
export function wholeNumber(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "").trim();
  if (!/^-?\d{1,7}$/.test(s)) return null;
  return Number(s);
}

/** A trimmed text field, or null when empty. */
export function text(value: FormDataEntryValue | null, max = 1000): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (s.length > max) throw new Error(`That is too long: ${max} characters at most.`);
  return s;
}
