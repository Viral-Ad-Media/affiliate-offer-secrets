// Referral program constants, shared by the /r capture route, the claim API, the Stripe webhook,
// and the Referrals/Rewards pages. Isomorphic — no server-only imports.

// Points awarded to the referrer when a referred account pays the access fee. Points redeem 1:1
// into credits_ledger (see redeem_rewards in 0036), so this is effectively "$25 of ad credit per
// paying referral" — a nominal launch figure, revisit before opening the program up widely.
export const REFERRAL_REWARD_POINTS = 25;

// Deliberately NOT httpOnly: a referral code is public (it's in the shareable URL), and the
// client component that triggers the claim needs to know whether a pending code exists before
// spending a round trip. The claim route still re-reads the cookie server-side rather than
// trusting anything in the request body.
export const REFERRAL_COOKIE = "ref_code";
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const REFERRAL_CODE_RE = /^[A-Z0-9]{8}$/;

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

export function referralLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/$/, "")}/r/${code}`;
}
