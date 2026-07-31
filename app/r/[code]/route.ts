import { NextResponse } from "next/server";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
  normalizeReferralCode,
} from "@/lib/referrals";

export const dynamic = "force-dynamic";

// Referral link capture: /r/{CODE} drops the code in a cookie and sends the visitor to signup.
//
// Public and anonymous by design — the visitor has no account yet, that's the whole point. This
// route deliberately does NOT look the code up or touch the database: an unauthenticated lookup
// would turn this into a code-enumeration oracle, and the code is validated for real inside
// claim_referral() once there's a session to attribute. An unparseable code just falls through
// to a normal signup with no cookie set, rather than erroring at someone who clicked a link.
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3400";
  const code = normalizeReferralCode(params.code);

  const res = NextResponse.redirect(new URL("/login?signup=1", appUrl));
  if (code) {
    res.cookies.set(REFERRAL_COOKIE, code, {
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}
