import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Every page is rendered per request, because every page carries a
 * Content-Security-Policy nonce and a nonce cannot be prerendered: the HTML
 * built once at deploy time would name a nonce that no later response's
 * header agrees with, and the browser would refuse every script on the page.
 *
 * Six pages were prerendered before this — the enquiry form, the sign-in
 * page, the two password pages, "no access" and the kiosk's "you are done" —
 * and all six broke exactly that way when the nonce was first switched on.
 * Setting it here rather than on each of them means a page added later cannot
 * quietly become static and break in a browser rather than in CI.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Hibiscus International Schools Admissions",
    template: "%s · Hibiscus International Schools",
  },
  description: "Take the first step towards joining Hibiscus International Schools.",
  // Parent pages are reached from emailed links and must never be indexed:
  // a search engine landing on /offer would be a data leak with a URL.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Parents fill these forms in on a phone. Letting the page zoom is an
  // accessibility requirement, not a nicety, so `maximumScale` is left alone.
  themeColor: "#f26a2e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background">{children}</body>
    </html>
  );
}
