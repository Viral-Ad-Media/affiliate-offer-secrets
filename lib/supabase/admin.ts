import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Only for trusted server-side code that must
// cross tenant boundaries: the engine CLI (background research/generation across all users), the
// Stripe webhook (writing credits/payments on a user's behalf after payment confirmation), and
// the public campaign-serving routes (lib/publicPage.ts, app/d/[[...path]]/route.ts).
// Never expose this client or the service-role key to the browser.
//
// `global.fetch` is forced to `cache: "no-store"` — Next.js's Data Cache will otherwise cache the
// GET requests this client's queries issue under the hood, independent of a Route Handler's own
// `export const dynamic = "force-dynamic"` (confirmed directly: a public-serving route toggled via
// campaigns.bridge_published kept serving a stale cached result across fresh `next start` restarts,
// reusing the same `.next/cache/fetch-cache` — this is why it went unnoticed until a route needed
// to reflect a value that actually changes at runtime; caching a service-role read was never
// correct anywhere this client is used, so this is a blanket fix, not a per-route patch).
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );
}
