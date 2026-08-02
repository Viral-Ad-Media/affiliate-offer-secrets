import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  debugToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getAdAccounts,
  getLinkedInstagramAccount,
  getMe,
  getUserPages,
} from "@/lib/meta/client";

export const dynamic = "force-dynamic";

function appUrl(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL);
}

function toExpiryIso(expiresAt: number): string | null {
  // Meta's own convention: 0 means "never expires".
  return expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
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
    .find((c) => c.startsWith("meta_oauth_state="))
    ?.split("=")[1];

  // The state cookie is single-use — always cleared on this response, success or failure.
  function redirectClearingCookie(pathWithQuery: string) {
    const res = NextResponse.redirect(appUrl(pathWithQuery));
    res.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  }

  if (errorParam) {
    return redirectClearingCookie("/settings/integrations?meta=cancelled");
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectClearingCookie("/settings/integrations?meta=error");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectClearingCookie("/login");

  const { data: ws } = await supabase.rpc("current_workspace_id");

  try {
    const { access_token: shortLived } = await exchangeCodeForToken(code);
    const { access_token: longLived } = await exchangeForLongLivedToken(shortLived);
    const [me, pages, tokenInfo, adAccounts] = await Promise.all([
      getMe(longLived),
      getUserPages(longLived),
      debugToken(longLived),
      getAdAccounts(longLived),
    ]);

    // Meta's consent dialog allows declining individual permissions — a successful token
    // exchange never guarantees a requested scope was actually granted. Checked explicitly so
    // the UI can gate "Launch Ad" proactively instead of failing deep inside a job stage later.
    const adsManagementGranted = tokenInfo.scopes.includes("ads_management");

    const admin = createAdminClient();

    const { data: userSecretId, error: secretErr } = await admin.rpc("store_meta_secret", {
      p_token: longLived,
      p_name: `meta_user_token_${user.id}`,
    });
    if (secretErr) throw new Error(secretErr.message);

    const { data: existingConnection } = await admin
      .from("meta_connections")
      .select("id")
      .eq("workspace_id", ws)
      .maybeSingle();

    let connectionId: string;
    if (existingConnection) {
      const { error } = await admin
        .from("meta_connections")
        .update({
          fb_user_id: me.id,
          user_token_secret_id: userSecretId,
          token_expires_at: toExpiryIso(tokenInfo.expires_at),
          ads_management_granted: adsManagementGranted,
          status: "connected",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingConnection.id);
      if (error) throw new Error(error.message);
      connectionId = existingConnection.id;
    } else {
      const { data: created, error } = await admin
        .from("meta_connections")
        .insert({
          user_id: user.id,
          fb_user_id: me.id,
          user_token_secret_id: userSecretId,
          token_expires_at: toExpiryIso(tokenInfo.expires_at),
          ads_management_granted: adsManagementGranted,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      connectionId = created!.id;
    }

    let anyActive = false;
    let anyActiveIg = false;
    for (const page of pages) {
      const { data: pageSecretId, error: pageSecretErr } = await admin.rpc("store_meta_secret", {
        p_token: page.access_token,
        p_name: `meta_page_token_${page.id}`,
      });
      if (pageSecretErr) throw new Error(pageSecretErr.message);

      const pageTokenInfo = await debugToken(page.access_token);

      const { data: existingPage } = await admin
        .from("meta_pages")
        .select("id, is_active")
        .eq("workspace_id", ws)
        .eq("page_id", page.id)
        .maybeSingle();

      const isActive = existingPage?.is_active ?? !anyActive;
      if (isActive) anyActive = true;

      if (existingPage) {
        await admin
          .from("meta_pages")
          .update({
            page_name: page.name,
            page_token_secret_id: pageSecretId,
            token_expires_at: toExpiryIso(pageTokenInfo.expires_at),
            status: "connected",
          })
          .eq("id", existingPage.id);
      } else {
        await admin.from("meta_pages").insert({
          user_id: user.id,
          connection_id: connectionId,
          page_id: page.id,
          page_name: page.name,
          page_token_secret_id: pageSecretId,
          token_expires_at: toExpiryIso(pageTokenInfo.expires_at),
          is_active: isActive,
        });
      }

      // Discover a linked Instagram Business account for this Page, if any. No separate token
      // stored — IG actions reuse this same Page's token (meta_pages.page_token_secret_id).
      const igAccount = await getLinkedInstagramAccount(page.id, page.access_token).catch(() => null);
      if (igAccount) {
        const { data: existingIg } = await admin
          .from("meta_instagram_accounts")
          .select("id, is_active")
          .eq("workspace_id", ws)
          .eq("ig_user_id", igAccount.id)
          .maybeSingle();

        const isActiveIg = existingIg?.is_active ?? !anyActiveIg;
        if (isActiveIg) anyActiveIg = true;

        if (existingIg) {
          await admin
            .from("meta_instagram_accounts")
            .update({ ig_username: igAccount.username, linked_page_id: page.id })
            .eq("id", existingIg.id);
        } else {
          await admin.from("meta_instagram_accounts").insert({
            user_id: user.id,
            connection_id: connectionId,
            ig_user_id: igAccount.id,
            ig_username: igAccount.username,
            linked_page_id: page.id,
            is_active: isActiveIg,
          });
        }
      }
    }

    // No separate per-ad-account token — Marketing API calls reuse the connection's own user
    // token (with ads_management), unlike Pages which get their own token via /me/accounts.
    let anyActiveAccount = false;
    for (const account of adAccounts) {
      const { data: existingAccount } = await admin
        .from("meta_ad_accounts")
        .select("id, is_active")
        .eq("workspace_id", ws)
        .eq("ad_account_id", account.id)
        .maybeSingle();

      const isActive = existingAccount?.is_active ?? !anyActiveAccount;
      if (isActive) anyActiveAccount = true;

      if (existingAccount) {
        await admin
          .from("meta_ad_accounts")
          .update({ ad_account_name: account.name, currency: account.currency })
          .eq("id", existingAccount.id);
      } else {
        await admin.from("meta_ad_accounts").insert({
          user_id: user.id,
          connection_id: connectionId,
          ad_account_id: account.id,
          ad_account_name: account.name,
          currency: account.currency,
          is_active: isActive,
        });
      }
    }

    return redirectClearingCookie("/settings/integrations?meta=connected");
  } catch (err: any) {
    console.error("Meta OAuth callback failed:", err?.message ?? err);
    return redirectClearingCookie("/settings/integrations?meta=error");
  }
}
