import { can } from "@/lib/permissions";
import { getStaff } from "@/lib/staff/session";
import { fromByteaHex } from "@/lib/stores/photo";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An item's photo, to somebody signed in who may read the register, and to
 * nobody else. Read through the caller's own client, so row-level security
 * answers as well as the check above. The address carries the photo's hash,
 * so the browser may keep it privately for as long as it likes: a new photo
 * is a new address.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaff();
  if (!ctx || !can(ctx.permissions, "stores.read")) return new Response("Forbidden", { status: 403 });
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const { data, error } = await ctx.supabase.from("stores_item_photos").select("bytes, sha256").eq("item_id", id).maybeSingle();
  if (error) return new Response("Could not read the photo.", { status: 500 });
  const bytes = fromByteaHex(data?.bytes);
  if (!data || !bytes) return new Response("Not found", { status: 404 });
  const asked = new URL(request.url).searchParams.get("v");
  const current = asked !== null && data.sha256.startsWith(asked) && asked.length >= 8;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      // Private: a shared cache must never hold it. Immutable only when the
      // address names this very photo.
      "Cache-Control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
      ETag: `"${data.sha256}"`,
    },
  });
}
