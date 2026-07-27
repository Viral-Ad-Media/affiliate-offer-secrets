import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GOOGLE_OAUTH_BASE, YOUTUBE_SCOPES, getGoogleClientId, getYoutubeRedirectUri } from "@/lib/google/config";

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
  const authUrl = new URL(GOOGLE_OAUTH_BASE);
  authUrl.searchParams.set("client_id", getGoogleClientId());
  authUrl.searchParams.set("redirect_uri", getYoutubeRedirectUri());
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  authUrl.searchParams.set("response_type", "code");
  // access_type=offline + prompt=consent guarantees a refresh_token is returned — Google only
  // returns one on the FIRST consent otherwise.
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("youtube_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
