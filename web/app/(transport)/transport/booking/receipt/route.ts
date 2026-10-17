import { redirect } from "next/navigation";
import { requireTransportSession } from "@/lib/tokens/server";
import { renderTransportReceipt } from "@/lib/transport/receipt";
import { loadSessionBooking, transportClient } from "@/lib/transport/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The receipt for this browser's paid booking, rendered on demand from the payment row. */
export async function GET(): Promise<Response> {
  const session = await requireTransportSession();
  const loaded = await loadSessionBooking(transportClient(), session);
  if (!loaded) redirect("/transport?expired=1");
  const receipt = await renderTransportReceipt(loaded);
  if (!receipt) return new Response("Not found", { status: 404 });
  return new Response(receipt.bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${receipt.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
