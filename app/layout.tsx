import type { Metadata } from "next";
import { Lexend, Source_Sans_3 } from "next/font/google";
import "./globals.css";

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
  "ClickBank Studio researches the marketplace, writes your ad copy and pages, builds funnels, and launches real ad campaigns — all from one dashboard.";

// Site-wide SEO defaults. Per-page metadata exports (marketing pages) override title/description;
// metadataBase makes every relative OG/canonical URL absolute. Funnel pages (/p, /d) keep their
// own noindex headers; public blog posts (/b) set their own tags in lib/blog.ts.
export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "ClickBank Studio — Find winning products, ship full campaigns",
    template: "%s — ClickBank Studio",
  },
  description: DESCRIPTION,
  applicationName: "ClickBank Studio",
  openGraph: {
    type: "website",
    siteName: "ClickBank Studio",
    title: "ClickBank Studio — Find winning products, ship full campaigns",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClickBank Studio",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
