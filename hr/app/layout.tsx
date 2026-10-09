import type { Metadata, Viewport } from "next";
import { Geist_Mono, Open_Sans, Poppins } from "next/font/google";
import "./globals.css";

// The website's fonts: Poppins for headings, Open Sans for everything else.
const body = Open_Sans({ variable: "--font-body", subsets: ["latin"] });
const head = Poppins({ variable: "--font-head", subsets: ["latin"], weight: ["600", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/**
 * Every page is rendered per request, because every page carries a
 * Content-Security-Policy nonce and a prerendered page would carry none.
 * `scripts/assert-nonce-safe-build.mjs` checks that this stays true.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Careers at Hibiscus International Schools",
    template: "%s · Hibiscus International Schools",
  },
  description: "Teaching posts at Hibiscus International Schools in Gaborone and Potchefstroom.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#172033",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${body.variable} ${head.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">{children}</body>
    </html>
  );
}
