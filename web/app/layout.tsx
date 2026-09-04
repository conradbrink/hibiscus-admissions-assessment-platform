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

export const metadata: Metadata = {
  title: {
    default: "Hibiscus Schools Admissions",
    template: "%s · Hibiscus Schools",
  },
  description: "Take the first step towards joining Hibiscus Schools.",
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
