import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
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
  themeColor: "#e8632b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">{children}</body>
    </html>
  );
}
