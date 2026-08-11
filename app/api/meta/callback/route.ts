import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
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
  type FbPage,
} from "@/lib/meta/client";

export const dynamic = "force-dynamic";

/**
 * Swallow a failure in a DISCOVERY call and name it in the log.
 *
 * These four Graph calls used to sit in one `Promise.all`, which made them all-or-nothing: a
 * single missing permission threw, the outer catch flattened it to "Something went wrong
 * connecting to Facebook", and the log said `(#200) Missing Permissions` without naming which
 * call. That is a genuinely bad failure — `/me/adaccounts` needs `ads_read`/`ads_management` and
 * `/me/accounts` needs `pages_show_list`, so an account with no ad account, or a Login-for-Business
 * configuration that simply didn't include a permission, could not connect AT ALL rather than
 * connecting with less. Instagram discovery already degraded this way; these now match it.
 *
 * Identity (`getMe`) and `debugToken` are deliberately NOT wrapped — without them there is no
 * fb_user_id and no way to know which scopes were granted, so there is nothing honest to store.
 */
function optional<T>(label: string, fallback: T) {
  return (err: unknown): T => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[meta callback] ${label} failed, continuing without it:`, message);
    return fallback;
  };
}

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
    // The clear must carry the same domain as the set, or the browser treats it as a different
    // cookie and the real one survives its own "single-use" clearing.
    res.cookies.set("meta_oauth_state", "", {
      maxAge: 0,
      path: "/",
      domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
    });
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

  // This one redirects rather than answering JSON — it is a top-level browser navigation back from
  // Meta, so a 401 body would just be text on a blank page. A null workspace here is also worse
  // than a failed query: every insert below stamps workspace_id explicitly (the trigger's
  // admin-client fallback would file the connection under the wrong workspace), so there is
  // nothing safe to write without one.
  const ws = await currentWorkspaceId();
  if (!ws) return redirectClearingCookie("/settings/integrations?meta=error");

  try {
    const { access_token: shortLived } = await exchangeCodeForToken(code);
    const { access_token: longLived } = await exchangeForLongLivedToken(shortLived);
    const [me, tokenInfo, pages, adAccounts] = await Promise.all([
      getMe(longLived),
      debugToken(longLived),
      getUserPages(longLived).catch(optional("getUserPages (/me/accounts, needs pages_show_list)", [] as FbPage[])),
      getAdAccounts(longLived).catch(
        optional("getAdAccounts (/me/adaccounts, needs ads_read or ads_management)", [] as {
          id: string;
          name: string;
          currency: string;
        }[]),
      ),
    ]);

    // What the app ACTUALLY received, which under Facebook Login for Business is decided by the
    // dashboard configuration rather than by anything in the request — so this is the only place
    // it can be observed. Scopes are not secrets; a permission silently absent from the
    // configuration is otherwise invisible until some later call fails for no obvious reason.
    console.log(`[meta callback] granted scopes: ${tokenInfo.scopes.join(",") || "(none)"}`);

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
          workspace_id: ws,
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

      // One page whose token can't be introspected must not abort the whole loop and lose every
      // page after it. Null expiry is the same "no known expiry" the non-expiring case stores.
      const pageTokenInfo = await debugToken(page.access_token).catch(
        optional(`debugToken(page ${page.id})`, { expires_at: 0, is_valid: true, scopes: [] as string[] }),
      );

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
          workspace_id: ws,
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
            workspace_id: ws,
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
          workspace_id: ws,
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
