import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setEntityStatus } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

type AdminClient = ReturnType<typeof createAdminClient>;

async function refundAndFail(
  admin: AdminClient,
  userId: string,
  launchId: string,
  amount: number,
  message: string
) {
  await admin
    .from("ad_launches")
    .update({ status: "failed", notes: message, updated_at: new Date().toISOString() })
    .eq("id", launchId);
  await admin.rpc("refund_ad_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: `refund: activation failed for launch ${launchId}`,
  });
}

// Single fast confirmed action, not a queued job — the client wants immediate feedback. Two
// independent race guards (see supabase/migrations/0008_ad_launches.sql for the full rationale):
// an optimistic ad_launches status transition (closes the same-launch double-activate race) run
// BEFORE reserve_ad_credits (closes the cross-launch balance race via an advisory lock).
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const body = await req.json();
  const launchId = body.launch_id as string | undefined;
  if (!launchId) return NextResponse.json({ error: "launch_id is required" }, { status: 400 });

  // ad_launches' RLS ("own ad launches", select-only for auth.uid()=user_id) is what makes this
  // an implicit ownership check — a row belonging to another tenant simply won't be visible.
  const { data: launch } = await supabase.from("ad_launches").select("*").eq("id", launchId).maybeSingle();
  if (!launch) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  if (launch.status !== "paused_review") {
    return NextResponse.json(
      { error: `Cannot activate from status: ${launch.status}` },
      { status: 409 }
    );
  }

  const admin = createAdminClient();

  const { data: claimed } = await admin
    .from("ad_launches")
    .update({ status: "activating", updated_at: new Date().toISOString() })
    .eq("id", launchId)
    .eq("status", "paused_review")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    return NextResponse.json({ error: "This launch is already being activated" }, { status: 409 });
  }

  const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_ad_credits", {
    p_amount: launch.budget_credits,
    p_reason: `ad launch: ${launch.campaign_id} angle ${launch.angle_index}`,
  });
  if (reserveErr || !reserved) {
    await admin
      .from("ad_launches")
      .update({ status: "paused_review", updated_at: new Date().toISOString() })
      .eq("id", launchId);
    return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
  }

  const { data: connection } = await admin
    .from("meta_connections")
    .select("user_token_secret_id")
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!connection) {
    await refundAndFail(admin, user.id, launchId, launch.budget_credits, "No Meta connection");
    return NextResponse.json({ error: "No Meta connection" }, { status: 500 });
  }

  const { data: token, error: tokenErr } = await admin.rpc("get_meta_secret", {
    p_secret_id: connection.user_token_secret_id,
  });
  if (tokenErr || !token) {
    await refundAndFail(
      admin,
      user.id,
      launchId,
      launch.budget_credits,
      "Could not retrieve Meta access token"
    );
    return NextResponse.json({ error: "Could not retrieve Meta access token" }, { status: 500 });
  }

  const levels: { key: "campaign" | "adset" | "ad"; id: string | null }[] = [
    { key: "campaign", id: launch.meta_campaign_id },
    { key: "adset", id: launch.meta_adset_id },
    { key: "ad", id: launch.meta_ad_id },
  ];

  const activationState: Record<string, string> = { ...(launch.activation_state ?? {}) };
  let failedAt: string | null = null;
  let failureMessage = "";

  for (const level of levels) {
    if (!level.id) {
      failedAt = level.key;
      failureMessage = `Missing ${level.key} id — launch didn't finish building`;
      break;
    }
    if (activationState[level.key] === "active") continue; // already done on a prior attempt
    try {
      await setEntityStatus(level.id, token, "ACTIVE");
      activationState[level.key] = "active";
    } catch (err: any) {
      failedAt = level.key;
      failureMessage = err?.message ?? `Failed to activate ${level.key}`;
      break;
    }
  }

  await admin
    .from("ad_launches")
    .update({ activation_state: activationState, updated_at: new Date().toISOString() })
    .eq("id", launchId);

  if (failedAt) {
    // Re-pause whatever DID activate — so the ledger and Meta's actual state never disagree
    // about whether anything is live — before writing the compensating refund.
    for (const level of levels) {
      if (activationState[level.key] === "active" && level.id) {
        try {
          await setEntityStatus(level.id, token, "PAUSED");
          activationState[level.key] = "paused";
        } catch {
          // best-effort compensation; the failure is already surfaced via notes regardless
        }
      }
    }

    await admin
      .from("ad_launches")
      .update({
        status: "failed",
        activation_state: activationState,
        notes: failureMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", launchId);

    await admin.rpc("refund_ad_credits", {
      p_user_id: user.id,
      p_amount: launch.budget_credits,
      p_reason: `refund: activation failed for launch ${launch.campaign_id} angle ${launch.angle_index}`,
    });

    return NextResponse.json({ error: failureMessage }, { status: 502 });
  }

  await admin
    .from("ad_launches")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", launchId);

  return NextResponse.json({ ok: true });
}
