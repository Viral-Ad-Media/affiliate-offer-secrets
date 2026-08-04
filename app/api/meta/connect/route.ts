import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FB_API_VERSION, FB_OAUTH_SCOPES, getFbClientId, getFbRedirectUri } from "@/lib/meta/config";

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
  const authUrl = new URL(`https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", getFbClientId());
  authUrl.searchParams.set("redirect_uri", getFbRedirectUri());
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", FB_OAUTH_SCOPES.join(","));
  authUrl.searchParams.set("response_type", "code");

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // Meta's redirect back is a top-level cross-site GET — "strict" drops this cookie
    maxAge: 600, // 10 minutes, matching Meta's authorization-code TTL
    path: "/",
    // Domain-wide: the connect flow can start on a workspace subdomain, but Meta only ever
    // redirects back to the canonical host's registered callback — a host-only cookie set on the
    // subdomain would never be sent there and every such flow would fail CSRF validation.
    domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
  });
  return res;
}
