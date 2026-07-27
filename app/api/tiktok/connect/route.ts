import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TIKTOK_OAUTH_BASE, TIKTOK_SCOPES, getTiktokClientKey, getTiktokRedirectUri } from "@/lib/tiktok/config";

export const dynamic = "force-dynamic";

function appUrl(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL);
}

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));

  const state = crypto.randomUUID().replace(/-/g, "");
  const authUrl = new URL(TIKTOK_OAUTH_BASE);
  authUrl.searchParams.set("client_key", getTiktokClientKey());
  authUrl.searchParams.set("redirect_uri", getTiktokRedirectUri());
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  authUrl.searchParams.set("response_type", "code");

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("tiktok_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
