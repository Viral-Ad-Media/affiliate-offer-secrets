import type { Metadata } from "next";
import { Lexend, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import ThemeScript from "@/components/ThemeScript";
import Toaster from "@/components/Toaster";

const lexend = Lexend({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://clickbank-studio.vercel.app";
const DESCRIPTION =
  "Affiliate Studio researches the marketplace, writes your ads, funnels, blog and emails, hosts them on your own domain, and launches real ad campaigns — all from one dashboard.";

// Site-wide SEO defaults. Per-page metadata exports (marketing pages) override title/description;
// metadataBase makes every relative OG/canonical URL absolute. Funnel pages (/p, /d) keep their
// own noindex headers; public blog posts (/b) set their own tags in lib/blog.ts.
export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Affiliate Studio — Find winning products, ship full campaigns",
    template: "%s — Affiliate Studio",
  },
  description: DESCRIPTION,
  applicationName: "Affiliate Studio",
  openGraph: {
    type: "website",
    siteName: "Affiliate Studio",
    title: "Affiliate Studio — Find winning products, ship full campaigns",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Affiliate Studio",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${sourceSans.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
