/** @type {import('next').NextConfig} */
const nextConfig = {
  // Connections / Domains / Billing moved under /settings. These keep the old URLs working for
  // bookmarks and — the case that actually matters — Stripe Checkout sessions created BEFORE the
  // move, whose success_url/cancel_url were baked in as `/billing?success=1` at creation time.
  // Without this a customer mid-checkout lands on a 404 immediately after paying.
  // 308 so the query string survives.
  async redirects() {
    return [
      { source: "/connections", destination: "/settings/connections", permanent: true },
      { source: "/domains", destination: "/settings/domains", permanent: true },
      { source: "/domains/:path*", destination: "/settings/domains/:path*", permanent: true },
      { source: "/billing", destination: "/settings/billing", permanent: true },
    ];
  },
};

export default nextConfig;
