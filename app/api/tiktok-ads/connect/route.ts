import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildTiktokAdsAuthUrl,
  tiktokAdsConfigured,
  TIKTOK_ADS_STATE_COOKIE,
} from "@/lib/tiktok/adsConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL));

  if (!tiktokAdsConfigured()) {
    return NextResponse.json(
      { error: "TikTok Ads isn't configured. Set TIKTOK_ADS_APP_ID and TIKTOK_ADS_SECRET." },
      { status: 400 }
    );
  }

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildTiktokAdsAuthUrl(state));
  res.cookies.set(TIKTOK_ADS_STATE_COOKIE, state, {
    httpOnly: true,
    // Lax, not Strict: TikTok's redirect back is a top-level cross-site GET and Strict would drop
    // the cookie entirely — the same reason Meta's connect route documents this choice.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
    // Domain-wide, same reasoning as Meta's: the flow can start on a workspace subdomain but
    // TikTok only redirects back to the canonical host's registered callback, so a host-only
    // cookie set on the subdomain would never be sent there and every such flow would fail CSRF.
    domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
  });
  return res;
}
