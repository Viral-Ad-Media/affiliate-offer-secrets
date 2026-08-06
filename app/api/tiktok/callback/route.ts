import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeTiktokCode, getTiktokUserInfo } from "@/lib/tiktok/client";

export const dynamic = "force-dynamic";

function appUrl(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const cookieState = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("tiktok_oauth_state="))
    ?.split("=")[1];

  function redirectClearingCookie(pathWithQuery: string) {
    const res = NextResponse.redirect(appUrl(pathWithQuery));
    // Same domain as the set, or the clear silently no-ops against a different cookie.
    res.cookies.set("tiktok_oauth_state", "", {
      maxAge: 0,
      path: "/",
      domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
    });
    return res;
  }

  if (errorParam) {
    return redirectClearingCookie("/settings/integrations?tiktok=cancelled");
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectClearingCookie("/settings/integrations?tiktok=error");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectClearingCookie("/login");

  // Redirects rather than answering JSON, same as Meta's callback: this is a top-level browser
  // navigation back from TikTok, and the insert below stamps workspace_id explicitly.
  const ws = await currentWorkspaceId();
  if (!ws) return redirectClearingCookie("/settings/integrations?tiktok=error");

  try {
    const tokens = await exchangeTiktokCode(code);
    const userInfo = await getTiktokUserInfo(tokens.access_token);

    const admin = createAdminClient();

    const { data: accessSecretId, error: accessSecretErr } = await admin.rpc("store_oauth_secret", {
      p_token: tokens.access_token,
      p_name: `tiktok_access_token_${user.id}`,
    });
    if (accessSecretErr) throw new Error(accessSecretErr.message);

    const { data: refreshSecretId, error: refreshSecretErr } = await admin.rpc("store_oauth_secret", {
      p_token: tokens.refresh_token,
      p_name: `tiktok_refresh_token_${user.id}`,
    });
    if (refreshSecretErr) throw new Error(refreshSecretErr.message);

    const { data: existing } = await admin
      .from("tiktok_connections")
      .select("id")
      .eq("workspace_id", ws)
      .maybeSingle();

    const row = {
      user_id: user.id,
      workspace_id: ws,
      tiktok_user_id: userInfo.open_id,
      tiktok_username: userInfo.display_name,
      avatar_url: userInfo.avatar_url,
      access_token_secret_id: accessSecretId,
      refresh_token_secret_id: refreshSecretId,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: "connected",
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await admin.from("tiktok_connections").update(row).eq("id", existing.id);
    } else {
      await admin.from("tiktok_connections").insert(row);
    }

    return redirectClearingCookie("/settings/integrations?tiktok=connected");
  } catch (err: any) {
    console.error("TikTok OAuth callback failed:", err?.message ?? err);
    return redirectClearingCookie("/settings/integrations?tiktok=error");
  }
}
