import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type { StaffContext } from "@/lib/staff/session";

/**
 * The two rules every transport download keeps, in one place.
 *
 * A failed read is refused, never turned into a short file: it would look
 * finished, be sent on, and the audit log would record a download of the
 * wrong list. And no record, no file: a list of children leaving the school
 * for the provider is exactly what the audit log is for, so a download it
 * could not record is not made. The same rules as the applicant list's
 * export (`app/staff/(console)/applications/export/route.ts`).
 */

const TEXT = { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" };

export function refused(what: string, e: unknown): Response {
  return new Response(`${what} could not be prepared: ${e instanceof Error ? e.message : String(e)}\n`, { status: 503, headers: TEXT });
}

export async function auditedWorkbook(
  ctx: StaffContext,
  audit: { action: string; entityType: string; entityId?: string | null; after: Record<string, unknown> },
  filename: string,
  body: Uint8Array<ArrayBuffer>
): Promise<Response> {
  const { error } = await createAdminClient()
    .from("audit_log")
    .insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: audit.action,
      entity_type: audit.entityType,
      entity_id: audit.entityId ?? null,
      after: { filename, ...audit.after } as Json,
    });
  if (error) return new Response(`The download could not be recorded, so it was not made: ${error.message}\n`, { status: 503, headers: TEXT });
  return new Response(new Blob([body]), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
