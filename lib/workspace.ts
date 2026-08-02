import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// The one place the app resolves "which workspace am I acting in". Every server page and route
// goes through this; nothing else should read `profiles.active_workspace_id` directly.
//
// This is the UX scope, NOT the security boundary. RLS already refuses to return a row from a
// workspace the caller isn't a member of (`is_workspace_member(workspace_id)`), so a wrong or
// stale value here shows the wrong workspace's data to someone entitled to see it — it can never
// leak across tenants. That separation is deliberate: it's what lets per-organization subdomains
// later become a change to how this function resolves, and nothing else.
//
// Queries still filter on it explicitly (`.eq("workspace_id", ws)`) rather than leaning on RLS
// alone, exactly as they always filtered on `user_id` despite the policy — belt and braces, and
// it's what keeps a member of two workspaces from seeing both sets merged into one list.
export async function currentWorkspaceId(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("current_workspace_id");
  if (error) return null;
  return (data as string | null) ?? null;
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

  const { data } = await supabase.rpc("current_workspace_id");
  return { supabase, userId: user.id, workspaceId: (data as string | null) ?? null };
}

// Server-side resolution for code holding the ADMIN client (the engine worker, webhooks, public
// routes) — there is no session there, so the workspace has to come from a row that already
// records it, or from the owning user. Prefer passing an existing row's workspace_id where one
// exists; this is the fallback for the "all I have is a user id" cases, chiefly the Stripe
// webhook, which only learns a user from the checkout session.
export async function workspaceIdForUser(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .order("role", { ascending: true }) // 'admin' < 'member' < 'owner' alphabetically; see below
    .limit(50);

  if (!data || data.length === 0) return null;
  // Prefer the workspace they own — that's the personal one every account gets at signup, and the
  // one their existing data was backfilled into.
  const owned = data.find((r) => (r as { role: string }).role === "owner");
  return ((owned ?? data[0]) as { workspace_id: string }).workspace_id;
}
