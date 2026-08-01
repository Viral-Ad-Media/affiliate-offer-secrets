import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_VIDEOS_BUCKET } from "@/lib/supabase/storage";
import { removeDomainFromProject } from "@/lib/vercel/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Delete this account and everything in it. Irreversible, so the route re-authenticates with the
// caller's own password first — supabase.auth.updateUser/admin.deleteUser both trust the session,
// and a hijacked session must not be able to destroy someone's account. Same reasoning as the
// change-password flow.
//
// Deleting the auth user cascades every tenant table (all of them declare
// `user_id references auth.users(id) on delete cascade`). Three things do NOT cascade, and are
// cleaned up explicitly first — an account that's "deleted" while its OAuth tokens still sit in
// Vault, its videos still sit in Storage, and its domains still route through the Vercel project
// isn't deleted in any sense the user would recognise:
//   1. Vault secrets       — vault.secrets is outside the FK graph entirely.
//   2. Storage objects     — storage.objects references nothing in public.
//   3. Vercel domains      — an external system that has never heard of our FKs.
//
// Cleanup is best-effort per item and never blocks the deletion: leaving someone unable to delete
// their account because a third-party API is down would be the worse failure. Anything that fails
// is reported back so it can be chased manually.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const confirmEmail = typeof body.confirm_email === "string" ? body.confirm_email.trim() : "";

  if (!password) return NextResponse.json({ error: "Password required" }, { status: 400 });
  // Typing the address is a second, deliberate speed bump — the password alone is muscle memory.
  if (confirmEmail.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "The email you typed doesn't match this account" }, { status: 400 });
  }

  // Re-auth on a THROWAWAY client, never `supabase` (the request-scoped, cookie-writing one).
  // signInWithPassword rewrites session cookies on that client, so a wrong password there logs the
  // real user out mid-request — confirmed live: a rejected delete attempt left the browser signed
  // out and every later API call silently 200'd with the login page's HTML instead of doing
  // anything. Checking a password must never be able to end the session it's checking.
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: reauthError } = await verifier.auth.signInWithPassword({
    email: user.email ?? "",
    password,
  });
  if (reauthError) return NextResponse.json({ error: "Password is incorrect" }, { status: 403 });

  const admin = createAdminClient();
  const failures: string[] = [];

  // 1. Vault secrets. Every connector column that points into Vault, gathered in one pass so a
  //    newly-added connector shows up as a missing entry here rather than a silent leak.
  const secretSources: { table: string; columns: string[] }[] = [
    { table: "meta_connections", columns: ["user_token_secret_id"] },
    { table: "meta_pages", columns: ["page_token_secret_id"] },
    { table: "tiktok_connections", columns: ["access_token_secret_id", "refresh_token_secret_id"] },
    { table: "youtube_connections", columns: ["access_token_secret_id", "refresh_token_secret_id"] },
    { table: "mail_connections", columns: ["access_token_secret_id", "refresh_token_secret_id"] },
    { table: "mail_provider_connections", columns: ["secret_id"] },
    { table: "everflow_connections", columns: ["api_key_secret_id"] },
  ];
  for (const src of secretSources) {
    const { data, error } = await admin.from(src.table).select(src.columns.join(", ")).eq("user_id", user.id);
    if (error) {
      failures.push(`${src.table}: ${error.message}`);
      continue;
    }
    for (const row of (data ?? []) as any[]) {
      for (const col of src.columns) {
        const id = row[col];
        if (!id) continue;
        // delete_oauth_secret deletes straight from vault.secrets by id, so it covers Meta's
        // tokens too even though those were stored through the older store_meta_secret wrapper —
        // there is no separate delete_meta_secret, and none is needed.
        const { error: delErr } = await admin.rpc("delete_oauth_secret", { p_secret_id: id });
        if (delErr) failures.push(`vault ${src.table}.${col}`);
      }
    }
  }

  // 2. Storage. Video paths are keyed by campaign id — both the legacy flat `{campaignId}.mp4` and
  //    the per-item `{campaignId}/{source}-{index}.mp4` shape.
  const { data: campaigns } = await admin.from("campaigns").select("id").eq("user_id", user.id);
  const campaignIds = (campaigns ?? []).map((c) => c.id as string);
  if (campaignIds.length > 0) {
    const paths: string[] = campaignIds.map((id) => `${id}.mp4`);
    for (const id of campaignIds) {
      const { data: listed } = await admin.storage.from(CAMPAIGN_VIDEOS_BUCKET).list(id);
      for (const obj of listed ?? []) paths.push(`${id}/${obj.name}`);
    }
    const { error: rmErr } = await admin.storage.from(CAMPAIGN_VIDEOS_BUCKET).remove(paths);
    if (rmErr) failures.push(`storage: ${rmErr.message}`);
  }

  // 3. Vercel domains. Only the ones this account actually got verified are attached to the
  //    project; a pending claim never reached Vercel's side in a way that needs undoing.
  const { data: domains } = await admin
    .from("custom_domains")
    .select("domain, status")
    .eq("user_id", user.id);
  for (const d of domains ?? []) {
    if (d.status !== "verified") continue;
    try {
      await removeDomainFromProject(d.domain as string);
    } catch (err) {
      failures.push(`vercel ${d.domain}`);
    }
  }

  // The actual deletion. Everything in public.* cascades from here.
  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    return NextResponse.json(
      { error: `Could not delete the account: ${deleteErr.message}` },
      { status: 500 }
    );
  }

  // Best-effort local sign-out; the account is gone either way, and the session's refresh token
  // dies with the user record.
  await supabase.auth.signOut().catch(() => {});

  return NextResponse.json({ ok: true, cleanupFailures: failures });
}
