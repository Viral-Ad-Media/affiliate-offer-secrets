import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClickBank Studio",
  description: "Local ClickBank affiliate engine cockpit — Claude Code is the engine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
