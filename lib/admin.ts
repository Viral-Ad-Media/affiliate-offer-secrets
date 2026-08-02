import { createClient } from "@/lib/supabase/server";

// The one place the admin surface decides whether a caller is a superadmin. Every /admin page and
// every /api/admin route goes through this — a second, hand-rolled check somewhere else is how
// these gates rot.
//
// Deliberately asks the DATABASE, via the RLS-scoped client, rather than reading a claim off the
// session: `is_superadmin()` is SECURITY DEFINER and answers only about auth.uid(), so the answer
// can't be forged by anything the browser sends. The admin client is never used to make this
// decision — it bypasses RLS, so using it here would mean the gate trusted its own caller.
export async function isSuperadmin(): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase.rpc("is_superadmin");
  if (error) return false; // fail closed
  return data === true;
}

// Pages call this. A non-superadmin (or a signed-out visitor) gets the same generic 404 as a route
// that doesn't exist — the admin surface shouldn't confirm its own existence to someone who can't
// use it, same no-oracle discipline as every public route in this app.
export async function requireSuperadminOr404(): Promise<void> {
  const { notFound } = await import("next/navigation");
  if (!(await isSuperadmin())) notFound();
}
