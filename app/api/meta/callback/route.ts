import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  debugToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
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
    return redirectClearingCookie("/connections?meta=cancelled");
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectClearingCookie("/connections?meta=error");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectClearingCookie("/login");

  try {
    const { access_token: shortLived } = await exchangeCodeForToken(code);
    const { access_token: longLived } = await exchangeForLongLivedToken(shortLived);
    const [me, pages, tokenInfo] = await Promise.all([
      getMe(longLived),
      getUserPages(longLived),
      debugToken(longLived),
    ]);

    const admin = createAdminClient();

    const { data: userSecretId, error: secretErr } = await admin.rpc("store_meta_secret", {
      p_token: longLived,
      p_name: `meta_user_token_${user.id}`,
    });
    if (secretErr) throw new Error(secretErr.message);

    const { data: existingConnection } = await admin
      .from("meta_connections")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    let connectionId: string;
    if (existingConnection) {
      const { error } = await admin
        .from("meta_connections")
        .update({
          fb_user_id: me.id,
          user_token_secret_id: userSecretId,
          token_expires_at: toExpiryIso(tokenInfo.expires_at),
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
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      connectionId = created!.id;
    }

    let anyActive = false;
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
        .eq("user_id", user.id)
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
    }

    return redirectClearingCookie("/connections?meta=connected");
  } catch (err: any) {
    console.error("Meta OAuth callback failed:", err?.message ?? err);
    return redirectClearingCookie("/connections?meta=error");
  }
}
