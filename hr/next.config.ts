import type { NextConfig } from "next";
import { NOINDEX_PATHS, securityHeaders } from "./lib/security-headers";

/**
 * Every response carries the security headers in `lib/security-headers.ts`,
 * where the policy is edited and unit tested. The Content-Security-Policy is
 * per request (it carries a nonce) and is set by `proxy.ts`.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      ...NOINDEX_PATHS.map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
