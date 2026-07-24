import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Only for trusted server-side code that must
// cross tenant boundaries: the engine CLI (background research/generation across all users) and
// the Stripe webhook (writing credits/payments on a user's behalf after payment confirmation).
// Never expose this client or the service-role key to the browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
