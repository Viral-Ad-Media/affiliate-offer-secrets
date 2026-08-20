import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookieOptions";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: AUTH_COOKIE_OPTIONS }
  );
}

/**
 * Send a password-reset email whose link works in ANY browser — not just the one that asked.
 *
 * The trap this exists to avoid: `@supabase/ssr`'s `createBrowserClient` hardcodes
 * `flowType: 'pkce'` (it sets it AFTER spreading caller options, so it cannot be overridden), and a
 * PKCE reset link carries a `?code=` that can only be exchanged in the SAME browser that requested
 * it — the `code_verifier` lives in that browser's storage. But a reset link is, by definition,
 * opened from an email client: routinely on another device, or inside the mail app's in-app
 * browser, where that verifier does not exist. Supabase still verifies the token server-side and
 * burns it (single use), so the link is then dead and retrying it can never work — the failure this
 * account hit twice (`recovery_token` cleared and `last_sign_in_at` advanced, while the page showed
 * "invalid or expired").
 *
 * Firing `/recover` through a plain implicit-flow client omits the PKCE challenge, so GoTrue emails
 * a link that delivers the recovery token in the URL FRAGMENT instead. `reset-password/page.tsx`
 * consumes that fragment via `detectSessionInUrl` with nothing from storage — cross-browser by
 * construction. This is the durable, in-repo counterpart to the Supabase "Reset Password" email
 * template using `{{ .TokenHash }}`; either one fixes it, and both can be in place at once.
 *
 * The client is throwaway: `persistSession:false` so it never touches the ssr cookie session on the
 * page that calls this, and it consumes no URL. Only the shape of the outbound request matters.
 */
export async function sendPasswordReset(email: string, redirectTo: string) {
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", persistSession: false, detectSessionInUrl: false, autoRefreshToken: false } }
  );
  return client.auth.resetPasswordForEmail(email, { redirectTo });
}
