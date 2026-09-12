import type { NextConfig } from "next";
import { NOINDEX_PATHS, securityHeaders } from "./lib/security-headers";

/**
 * The headers below are the application's outermost security control. Every
 * response carries them; `lib/security-headers.ts` explains each one and is
 * where the policy is edited and unit tested.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      // Everything behind a link, a session or a code stays out of search
      // results even if an address is shared or scraped.
      ...NOINDEX_PATHS.map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
