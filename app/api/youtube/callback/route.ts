import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeGoogleCode, getMyYoutubeChannel } from "@/lib/google/client";
import { getYoutubeRedirectUri } from "@/lib/google/config";

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
    .find((c) => c.startsWith("youtube_oauth_state="))
    ?.split("=")[1];

  function redirectClearingCookie(pathWithQuery: string) {
    const res = NextResponse.redirect(appUrl(pathWithQuery));
    res.cookies.set("youtube_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  }

  if (errorParam) {
    return redirectClearingCookie("/connections?youtube=cancelled");
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectClearingCookie("/connections?youtube=error");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectClearingCookie("/login");

  try {
    const tokens = await exchangeGoogleCode(code, getYoutubeRedirectUri());
    const channel = await getMyYoutubeChannel(tokens.access_token);
    if (!channel) throw new Error("No YouTube channel found for this account");

    const admin = createAdminClient();

    const { data: accessSecretId, error: accessSecretErr } = await admin.rpc("store_oauth_secret", {
      p_token: tokens.access_token,
      p_name: `youtube_access_token_${user.id}`,
    });
    if (accessSecretErr) throw new Error(accessSecretErr.message);

    let refreshSecretId: string | null = null;
    if (tokens.refresh_token) {
      const { data, error } = await admin.rpc("store_oauth_secret", {
        p_token: tokens.refresh_token,
        p_name: `youtube_refresh_token_${user.id}`,
      });
      if (error) throw new Error(error.message);
      refreshSecretId = data;
    }

    const { data: existing } = await admin
      .from("youtube_connections")
      .select("id, refresh_token_secret_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const row = {
      user_id: user.id,
      channel_id: channel.id,
      channel_title: channel.title,
      thumbnail_url: channel.thumbnailUrl,
      access_token_secret_id: accessSecretId,
      // Only overwrite the refresh token if a new one was actually returned — Google may omit it
      // on a re-consent within the same session.
      refresh_token_secret_id: refreshSecretId ?? existing?.refresh_token_secret_id ?? null,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: "connected",
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await admin.from("youtube_connections").update(row).eq("id", existing.id);
    } else {
      await admin.from("youtube_connections").insert(row);
    }

    return redirectClearingCookie("/connections?youtube=connected");
  } catch (err: any) {
    console.error("YouTube OAuth callback failed:", err?.message ?? err);
    return redirectClearingCookie("/connections?youtube=error");
  }
}
