import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { classifyHost } from "@/lib/host";
import type { SupabaseClient } from "@supabase/supabase-js";

// The one place the app resolves "which workspace am I acting in".
//
// This file used to SAY that and not be true: it had zero callers, while all 60 server-side
// resolutions inlined `supabase.rpc("current_workspace_id")` themselves — none of them checking
// the RPC's error, so a failure silently became `undefined` and the following
// `.eq("workspace_id", undefined)` ran anyway. Per-organization subdomains are what forced the
// issue: the answer now depends on the request's Host, and 60 copies of it cannot each learn that.
//
// This is the UX scope, NOT the security boundary. RLS already refuses to return a row from a
// workspace the caller isn't a member of (`is_workspace_member(workspace_id)`), so a wrong or
// stale value here shows the wrong workspace's data to someone entitled to see it — it can never
// leak across tenants. Queries still filter on it explicitly (`.eq("workspace_id", ws)`) rather
// than leaning on RLS alone, exactly as they always filtered on `user_id` despite the policy.

// Resolution order, and why it is this way round:
//
//   1. The hostname. On acme.affiliateoffersecrets.com the answer is acme's workspace, full stop —
//      which is the entire point of subdomains. Because it is derived per request rather than read
//      from per-account state, two workspaces open in two tabs each stay correctly scoped; the
//      cheaper alternative (write active_workspace_id on arrival) would have let whichever tab
//      loaded last silently re-scope the other.
//   2. Otherwise `current_workspace_id()`, i.e. profiles.active_workspace_id — unchanged behavior
//      on the canonical host, and the fallback for a subdomain naming a workspace you don't belong
//      to (workspace_id_for_slug returns NULL for that, indistinguishably from "no such slug").
//
// `cache()` dedupes this per request: several server components on one page each call it, and the
// RPC should not run once per caller.
export const currentWorkspaceId = cache(async (): Promise<string | null> => {
  const supabase = createClient();

  const slug = workspaceSlugFromHost();
  if (slug) {
    const { data } = await supabase.rpc("workspace_id_for_slug", { p_slug: slug });
    const id = (data as string | null) ?? null;
    if (id) return id;
  }

  const { data, error } = await supabase.rpc("current_workspace_id");
  if (error) return null;
  return (data as string | null) ?? null;
});

// Null unless this request arrived on a workspace subdomain. Exported because the `(app)` layout
// needs to know "am I already on a subdomain?" to decide whether to redirect there, which is a
// different question from "which workspace is this" — a subdomain you aren't a member of has a
// slug but no workspace.
export function workspaceSlugFromHost(): string | null {
  let host: string | null = null;
  try {
    host = headers().get("host");
  } catch {
    // Outside a request scope (static generation). Every caller here also reads cookies, so this
    // shouldn't happen — but throwing from scope resolution would be a worse failure than falling
    // back to the account's active workspace.
    return null;
  }
  const kind = classifyHost(host);
  return kind.kind === "workspace" ? kind.slug : null;
}

// For the many routes that need both. Returns nulls rather than throwing so each caller keeps
// its own 401/redirect behaviour — the shapes differ (pages redirect, routes return JSON).
export async function currentUserAndWorkspace(): Promise<{
  supabase: SupabaseClient;
  userId: string | null;
  workspaceId: string | null;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, userId: null, workspaceId: null };

  return { supabase, userId: user.id, workspaceId: await currentWorkspaceId() };
}

// Server-side resolution for code holding the ADMIN client (the engine worker, webhooks, public
// routes) — there is no session and no meaningful Host there, so the workspace has to come from a
// row that already records it, or from the owning user.
//
// Currently unused: the Stripe webhook, its intended consumer, doesn't set workspace_id at all and
// instead relies on 0058's `stamp_workspace_id()` BEFORE INSERT trigger, which derives exactly the
// same answer in the database. Kept because it is the right helper for any admin-client path that
// needs the id in hand rather than at insert time — but prefer passing an existing row's
// workspace_id where one exists.
export async function workspaceIdForUser(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .limit(50);

  if (!data || data.length === 0) return null;
  // Prefer the workspace they own — that's the personal one every account gets at signup, and the
  // one their existing data was backfilled into.
  const owned = data.find((r) => (r as { role: string }).role === "owner");
  return ((owned ?? data[0]) as { workspace_id: string }).workspace_id;
}
