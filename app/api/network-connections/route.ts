import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWorkspaceId } from "@/lib/workspace";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

export const dynamic = "force-dynamic";

const NETWORKS = ["clickbank", "digistore24"] as const;
// The same charset network_connections' CHECK enforces, restated so a bad value comes back as a
// sentence instead of a constraint violation.
const AFFILIATE_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Save an affiliate id — and RE-RENDER every funnel in the workspace, which is the whole reason
 * this route exists.
 *
 * `NetworkConnectionsPanel` used to upsert `network_connections` directly from the browser. The
 * row updated, the UI said "Connected", and every already-built page kept the OLD affiliate id:
 * hoplinks are baked into stored HTML at write time (buildHoplink runs during render, not at
 * serve time), so nothing re-reads this table until something re-renders. Correcting a nickname
 * silently did nothing to the pages that use it, which is worse than failing — the operator has
 * every reason to believe it took effect, and the pages keep crediting the wrong account.
 *
 * This is exactly what `PATCH /api/products/[id]/hoplink` already guards against for a single
 * product's override. The affiliate id is the same class of value with a wider blast radius: it
 * appears in every hoplink on every funnel in the workspace, not one product's.
 *
 * Re-render failures are COUNTED AND RETURNED, never thrown — the id is already saved by then, and
 * reporting "couldn't save" would invite a retry that changes nothing. Same call as the hoplink
 * route makes.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const network = typeof body.network === "string" ? body.network : "";
  const affiliateId = typeof body.affiliate_id === "string" ? body.affiliate_id.trim() : "";

  if (!(NETWORKS as readonly string[]).includes(network)) {
    return NextResponse.json({ error: "Unknown network" }, { status: 400 });
  }
  if (!AFFILIATE_ID_RE.test(affiliateId)) {
    return NextResponse.json(
      { error: "Letters, numbers, and . _ - only — it's the short id from your network account." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Workspace-scoped, and stamped explicitly rather than left to stamp_workspace_id(): this runs
  // on the admin client where auth.uid() is null, so the trigger's fallback would file it under
  // the caller's first OWNED workspace — wrong for anyone in two.
  const { error: upsertErr } = await admin.from("network_connections").upsert(
    {
      user_id: user.id,
      workspace_id: ws,
      network,
      affiliate_id: affiliateId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,network" }
  );
  if (upsertErr) {
    return NextResponse.json({ error: "Couldn't save — check the format and try again" }, { status: 400 });
  }

  // Every funnel in the workspace, not just this network's: a campaign's network lives on its
  // product, and re-rendering one that didn't change is a no-op that costs a render rather than a
  // wrong link.
  const { data: campaigns } = await admin
    .from("campaigns")
    .select("id")
    .eq("workspace_id", ws)
    .not("bridge_html", "is", null);

  let rerendered = 0;
  let failed = 0;
  for (const c of campaigns ?? []) {
    try {
      await rerenderFunnelSequence(admin, c.id as string, ws);
      rerendered++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, affiliate_id: affiliateId, rerendered, failed });
}
