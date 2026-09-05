/** The development gateway page and its simulate action exist only outside production with the dev adapter. */
export function devGatewayEnabled(): boolean {
  return process.env.VERCEL_ENV !== "production" && (process.env.PAYMENT_PROVIDER ?? "dev") === "dev";
}
