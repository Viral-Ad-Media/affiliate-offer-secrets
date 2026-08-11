import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  FB_API_VERSION,
  FB_OAUTH_SCOPES,
  getFbClientId,
  getFbLoginConfigId,
  getFbRedirectUri,
} from "@/lib/meta/config";

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
  authUrl.searchParams.set("response_type", "code");

  const configId = getFbLoginConfigId();
  if (configId) {
    // Facebook Login for Business. The permission set lives in the dashboard configuration, so
    // `scope` is deliberately NOT sent — Meta's docs say config_id replaced it and recommend
    // against including both.
    authUrl.searchParams.set("config_id", configId);
    // Without this the configuration's OWN default response type wins and our `response_type=code`
    // is ignored — which would hand back a token in the fragment that the server-side callback
    // never sees, and it would look like the callback silently did nothing.
    authUrl.searchParams.set("override_default_response_type", "true");
  } else {
    authUrl.searchParams.set("scope", FB_OAUTH_SCOPES.join(","));
  }

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
