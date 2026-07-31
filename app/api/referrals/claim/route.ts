import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { REFERRAL_COOKIE, normalizeReferralCode } from "@/lib/referrals";

export const dynamic = "force-dynamic";

// Attribute the signed-in account to whoever's referral link they arrived through.
//
// The code comes ONLY from the httpOnly-adjacent cookie set by /r/{code} — never from the request
// body — so a caller can't attribute themselves to an arbitrary code by POSTing one. Everything
// that actually matters (self-referral, one-referrer-ever, the 7-day signup window) is enforced
// inside claim_referral() via the user-scoped client, so this route is plumbing, not the boundary.
//
// Every outcome clears the cookie and returns 200: a stale cookie, a self-referral, or an
// already-attributed account are all ordinary states for someone who just signed up, and the
// caller (ReferralClaimer, mounted app-wide) has nothing useful to do with an error.
export async function POST() {
  const jar = cookies();
  const code = normalizeReferralCode(jar.get(REFERRAL_COOKIE)?.value);

  const clear = (body: Record<string, unknown>) => {
    const res = NextResponse.json(body);
    res.cookies.set(REFERRAL_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (!code) return clear({ ok: true, status: "no_code" });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // No session yet — keep the cookie so the claim can still happen after they finish signing up.
  if (!user) return NextResponse.json({ ok: false, status: "not_signed_in" }, { status: 401 });

  const { data, error } = await supabase.rpc("claim_referral", { p_code: code });
  if (error) return clear({ ok: false, status: "error", error: error.message });

  return clear({ ok: true, status: data });
}
