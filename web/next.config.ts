import type { NextConfig } from "next";
import { NOINDEX_PATHS, securityHeaders } from "./lib/security-headers";

/**
 * The headers below are the application's outermost security control. Every
 * response carries them; `lib/security-headers.ts` explains each one and is
 * where the policy is edited and unit tested.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      // The staff orientation was removed on 13 October 2026. For the month
      // before, a first visit to the dashboard was sent there, so browsers
      // still open /staff/orientation from history, bookmarks and start pages.
      // Without this, that person lands on a bare "not found" and believes the
      // orientation is still waiting for them. Temporary, so that no browser
      // caches it for good in case the path is ever used again.
      { source: "/staff/orientation/:path*", destination: "/staff", permanent: false },
    ];
  },
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
