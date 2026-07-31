"use client";

import { useEffect } from "react";
import { REFERRAL_COOKIE } from "@/lib/referrals";

// Fires the referral claim once, silently, the first time a referred user reaches the app shell.
//
// Mounted in the (app) layout rather than the signup handler so it works regardless of how the
// account was created (password signup, magic link, OAuth later). It reads document.cookie first
// and only spends a round trip when a pending code is actually present — for the ~100% of page
// loads with no cookie this costs nothing. The route re-reads the cookie server-side, so nothing
// here is trusted; this component only decides *whether* to ask.
export default function ReferralClaimer() {
  useEffect(() => {
    const hasCode = document.cookie
      .split("; ")
      .some((c) => c.startsWith(`${REFERRAL_COOKIE}=`) && c.length > REFERRAL_COOKIE.length + 1);
    if (!hasCode) return;

    // Fire-and-forget: the outcome is never surfaced. A failed claim must not interrupt someone
    // who just wanted to use the app, and the route clears the cookie either way so this can't
    // loop on the next navigation.
    fetch("/api/referrals/claim", { method: "POST" }).catch(() => {});
  }, []);

  return null;
}
