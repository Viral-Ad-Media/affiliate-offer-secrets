import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeTiktokAdsAuthCode, listTiktokAdvertisers } from "@/lib/tiktok/ads";
import { TIKTOK_ADS_STATE_COOKIE } from "@/lib/tiktok/adsConfig";

export const dynamic = "force-dynamic";

function appUrl(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL);
}

/**
 * TikTok for Business (Marketing API) OAuth callback.
 *
 * Mirrors app/api/tiktok/callback/route.ts deliberately — same CSRF shape, same Vault storage via
 * the generic `store_oauth_secret`, same redirect-rather-than-JSON behaviour (this is a top-level
 * browser navigation back from TikTok). The differences are all consequences of it being a
 * different app: its own state cookie, its own token exchange, and an ADVERTISER list instead of a
 * single creator identity.
 *
 * TikTok returns `auth_code`, not `code`, on this flow — a real difference from Login Kit, and the
 * kind of thing that silently produces "invalid code" if you assume the two are the same.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Accept both spellings: the portal has used `auth_code`, and `code` appears in some flows.
  // Reading either costs nothing and avoids a callback that fails on a naming difference.
  const authCode = url.searchParams.get("auth_code") ?? url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${TIKTOK_ADS_STATE_COOKIE}=`))
    ?.split("=")[1];

  function redirectClearingCookie(pathWithQuery: string) {
    const res = NextResponse.redirect(appUrl(pathWithQuery));
    // Same domain as the set, or the clear silently no-ops against a different cookie.
    res.cookies.set(TIKTOK_ADS_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/",
      domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
    });
    return res;
  }

  if (url.searchParams.get("error")) {
    return redirectClearingCookie("/ads/tiktok?connect=cancelled");
  }
  if (!authCode || !state || !cookieState || state !== cookieState) {
    return redirectClearingCookie("/ads/tiktok?connect=error");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectClearingCookie("/login");

  // Resolved and stamped EXPLICITLY. The insert below runs on the admin client where auth.uid() is
  // null, so stamp_workspace_id()'s fallback would file the connection under this user's first
  // owned workspace — connecting from workspace B would land it in workspace A and then be
  // invisible to every (workspace-scoped) read. Same trap CLAUDE.md documents for Meta's callback.
  const ws = await currentWorkspaceId();
  if (!ws) return redirectClearingCookie("/ads/tiktok?connect=error");

  try {
    const token = await exchangeTiktokAdsAuthCode(authCode);
    const advertisers = await listTiktokAdvertisers(token.access_token);
    if (advertisers.length === 0) {
      return redirectClearingCookie("/ads/tiktok?connect=no_advertisers");
    }

    const admin = createAdminClient();
    const { data: accessSecretId, error: accessErr } = await admin.rpc("store_oauth_secret", {
      p_token: token.access_token,
      p_name: `tiktok_ads_access_token_${user.id}`,
    });
    if (accessErr) throw new Error(accessErr.message);

    let refreshSecretId: string | null = null;
    if (token.refresh_token) {
      const { data, error } = await admin.rpc("store_oauth_secret", {
        p_token: token.refresh_token,
        p_name: `tiktok_ads_refresh_token_${user.id}`,
      });
      if (error) throw new Error(error.message);
      refreshSecretId = data as string;
    }

    // One row per advertiser this token can act on. The first becomes active so a tenant with a
    // single ad account never has to make a choice that has only one answer.
    const { data: alreadyActive } = await admin
      .from("tiktok_ad_accounts")
      .select("advertiser_id")
      .eq("workspace_id", ws)
      .eq("is_active", true)
      .maybeSingle();

    const rows = advertisers.map((a, i) => ({
      user_id: user.id,
      workspace_id: ws,
      advertiser_id: a.advertiser_id,
      advertiser_name: a.advertiser_name ?? null,
      access_token_secret_id: accessSecretId as string,
      refresh_token_secret_id: refreshSecretId,
      token_expires_at: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null,
      is_active: alreadyActive ? false : i === 0,
      status: "connected" as const,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertErr } = await admin
      .from("tiktok_ad_accounts")
      .upsert(rows, { onConflict: "workspace_id,advertiser_id" });
    if (upsertErr) throw new Error(upsertErr.message);

    return redirectClearingCookie("/ads/tiktok?connect=ok");
  } catch (err) {
    console.error("tiktok-ads callback failed", err);
    return redirectClearingCookie("/ads/tiktok?connect=error");
  }
}
