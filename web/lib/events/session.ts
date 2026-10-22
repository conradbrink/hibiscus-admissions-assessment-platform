import "server-only";
import { cookies } from "next/headers";

/**
 * The order a browser is in the middle of paying for.
 *
 * The gateway sends the buyer back to `/events/return`, which has to know
 * which order to ask about and where the tickets are. Putting the link to the
 * tickets in the return address would hand it to the gateway, which keeps the
 * address in its own logs. So the browser keeps it instead, in a cookie set
 * when the checkout starts and good for the day a checkout stays open.
 *
 * It is the same token the email carries, and opens only that one order's
 * tickets. `lax`, so it rides along on the top-level GET a gateway's
 * cross-site POST is redirected to, and on nothing else from another site.
 */

export const EVENT_ORDER_COOKIE = "hbs_event_order";

export async function rememberOrder(token: string): Promise<void> {
  const store = await cookies();
  store.set(EVENT_ORDER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 86_400,
  });
}

/** The token, or null. Its shape is checked by whoever looks it up. */
export async function rememberedOrderToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(EVENT_ORDER_COOKIE)?.value ?? null;
}
