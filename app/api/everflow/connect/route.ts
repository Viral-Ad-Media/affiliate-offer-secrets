import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyApiKey } from "@/lib/everflow/client";

export const dynamic = "force-dynamic";

// Connect an Everflow-platform network by pasting the affiliate API key from that network's own
// partner portal. No OAuth: Everflow issues keys per affiliate account, and every network on the
// platform requires manual affiliate approval anyway — so each user brings their own credential,
// the same shape as the ClickBank nickname flow.
//
// Two credentials with two different sensitivities:
//   • the API key      → verified live, then Vault (store_oauth_secret) + everflow_connections,
//                        which has no client grants at all.
//   • the affiliate id → network_connections, the existing plain table. It's public — it's in
//                        every tracking URL — and keeping it there means the entitlement checks
//                        the discovery/build routes already run need no special case.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const body = await req.json().catch(() => ({}));
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  const affiliateId = typeof body.affiliate_id === "string" ? body.affiliate_id.trim() : "";
  const networkName = typeof body.network_name === "string" ? body.network_name.trim().slice(0, 80) : null;

  if (!apiKey) return NextResponse.json({ error: "API key required" }, { status: 400 });
  // Same charset the network_connections CHECK enforces — reject here so the user gets a sentence
  // instead of a constraint violation.
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(affiliateId)) {
    return NextResponse.json(
      { error: "Affiliate ID should be the short id from your network portal — letters, numbers, dashes." },
      { status: 400 }
    );
  }

  // Never store a key that doesn't work: a wrong key and a missing key look identical from outside
  // (both 401), so the only way to tell the user now rather than at their first failed discovery
  // run is to make a real request.
  const check = await verifyApiKey(apiKey);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

  const admin = createAdminClient();
  const { data: secretId, error: secretErr } = await admin.rpc("store_oauth_secret", {
    p_token: apiKey,
    p_name: `everflow_${user.id}`,
  });
  if (secretErr || !secretId) {
    return NextResponse.json({ error: secretErr?.message ?? "Could not store the key" }, { status: 500 });
  }

  // Replacing a key leaves the previous Vault secret orphaned otherwise — the same hygiene the
  // Google token refresh path does with delete_oauth_secret.
  const { data: existing } = await admin
    .from("everflow_connections")
    .select("api_key_secret_id")
    .eq("workspace_id", ws)
    .maybeSingle();

  const { error: connErr } = await admin.from("everflow_connections").upsert(
    {
      user_id: user.id,
      api_key_secret_id: secretId,
      network_name: networkName,
      status: "connected",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (connErr) return NextResponse.json({ error: connErr.message }, { status: 500 });

  if (existing?.api_key_secret_id && existing.api_key_secret_id !== secretId) {
    await admin.rpc("delete_oauth_secret", { p_secret_id: existing.api_key_secret_id });
  }

  const { error: netErr } = await admin.from("network_connections").upsert(
    { user_id: user.id, network: "everflow", affiliate_id: affiliateId, updated_at: new Date().toISOString() },
    { onConflict: "user_id,network" }
  );
  if (netErr) return NextResponse.json({ error: netErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
