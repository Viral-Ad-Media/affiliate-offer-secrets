import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setEntityStatus } from "@/lib/meta/client";

export const dynamic = "force-dynamic";
// The database lease is two minutes. Keep the platform's hard invocation ceiling comfortably
// below that so an old request cannot still be talking to Meta after a replacement may claim it.
export const maxDuration = 60;

type AdminClient = ReturnType<typeof createAdminClient>;

async function holdReservationForRetry(
  admin: AdminClient,
  launchId: string,
  leaseId: string,
  message: string,
  activationState?: Record<string, string>
) {
  const { data, error } = await admin
    .from("ad_launches")
    .update({
      status: "activating",
      activation_locked_at: null,
      activation_lease_id: null,
      notes: message,
      ...(activationState ? { activation_state: activationState } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", launchId)
    .eq("status", "activating")
    .eq("activation_lease_id", leaseId)
    .select("id")
    .maybeSingle();
  if (error) console.error("Could not release ad activation lease", error.message);
  return Boolean(data);
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

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  // Members can create/edit campaign material, but only an owner/admin may commit the shared
  // workspace's credits to real ad spend. reserve_ad_credits re-checks this inside the transaction;
  // this early check only gives the caller a clear response before claiming the launch.
  const { data: role, error: roleErr } = await supabase.rpc("workspace_role", {
    p_workspace_id: ws,
  });
  if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json(
      { error: "Only workspace owners and admins can activate ads" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const launchId = body.launch_id as string | undefined;
  if (!launchId) return NextResponse.json({ error: "launch_id is required" }, { status: 400 });

  // Workspace-scoped RLS plus the explicit active-workspace predicate make this the route-level
  // ownership check; the reservation RPC independently derives and re-checks the launch workspace.
  const { data: launch } = await supabase
    .from("ad_launches")
    .select("*")
    .eq("id", launchId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!launch) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  if (launch.status !== "paused_review" && launch.status !== "activating") {
    return NextResponse.json(
      { error: `Cannot activate from status: ${launch.status}` },
      { status: 409 }
    );
  }
  const resuming = launch.status === "activating";

  const admin = createAdminClient();
  const leaseId = crypto.randomUUID();

  const { data: claimed, error: claimErr } = await supabase.rpc("claim_ad_activation", {
    p_launch_id: launchId,
    p_lease_id: leaseId,
  });
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 409 });
  if (!claimed) {
    return NextResponse.json(
      { error: "This launch is already being activated. Try again in two minutes if it stalls." },
      { status: 409 }
    );
  }

  const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_ad_credits", {
    p_launch_id: launchId,
  });
  if (reserveErr) {
    if (resuming) await holdReservationForRetry(admin, launchId, leaseId, reserveErr.message);
    else {
      await admin
        .from("ad_launches")
        .update({
          status: "paused_review",
          activation_locked_at: null,
          activation_lease_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", launchId)
        .eq("status", "activating")
        .eq("activation_lease_id", leaseId);
    }
    return NextResponse.json({ error: reserveErr.message }, { status: 500 });
  }
  if (!reserved) {
    await admin
      .from("ad_launches")
      .update({
        status: "paused_review",
        activation_locked_at: null,
        activation_lease_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", launchId)
      .eq("status", "activating")
      .eq("activation_lease_id", leaseId);
    return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
  }

  // The resumable claim may have picked up progress written by an earlier request. Always drive
  // Meta from the fresh locked-row state, not the pre-claim snapshot above.
  const { data: currentLaunch, error: currentLaunchErr } = await admin
    .from("ad_launches")
    .select("*")
    .eq("id", launchId)
    .eq("workspace_id", ws)
    .single();
  if (currentLaunchErr || !currentLaunch) {
    await holdReservationForRetry(
      admin,
      launchId,
      leaseId,
      "Could not reload activation state"
    );
    return NextResponse.json({ error: "Could not reload activation state" }, { status: 500 });
  }

  const { data: connection } = await admin
    .from("meta_connections")
    .select("user_token_secret_id")
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!connection) {
    if (resuming) {
      await holdReservationForRetry(
        admin,
        launchId,
        leaseId,
        "Reconnect Meta, then resume activation"
      );
    } else {
      const { error: finalizeErr } = await admin.rpc("finalize_failed_ad_activation", {
        p_launch_id: launchId,
        p_lease_id: leaseId,
        p_notes: "No Meta connection",
        p_activation_state: currentLaunch.activation_state ?? {},
      });
      if (finalizeErr) {
        return NextResponse.json({ error: "Activation cleanup needs retry" }, { status: 500 });
      }
    }
    return NextResponse.json({ error: "No Meta connection" }, { status: 500 });
  }

  const { data: token, error: tokenErr } = await admin.rpc("get_meta_secret", {
    p_secret_id: connection.user_token_secret_id,
  });
  if (tokenErr || !token) {
    if (resuming) {
      await holdReservationForRetry(
        admin,
        launchId,
        leaseId,
        "Reconnect Meta, then resume activation"
      );
    } else {
      const { error: finalizeErr } = await admin.rpc("finalize_failed_ad_activation", {
        p_launch_id: launchId,
        p_lease_id: leaseId,
        p_notes: "Could not retrieve Meta access token",
        p_activation_state: currentLaunch.activation_state ?? {},
      });
      if (finalizeErr) {
        return NextResponse.json({ error: "Activation cleanup needs retry" }, { status: 500 });
      }
    }
    return NextResponse.json({ error: "Could not retrieve Meta access token" }, { status: 500 });
  }

  const levels: { key: "campaign" | "adset" | "ad"; id: string | null }[] = [
    { key: "campaign", id: currentLaunch.meta_campaign_id },
    { key: "adset", id: currentLaunch.meta_adset_id },
    { key: "ad", id: currentLaunch.meta_ad_id },
  ];

  const activationState: Record<string, string> = { ...(currentLaunch.activation_state ?? {}) };
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
      const { data: stateSaved, error: stateSaveErr } = await admin
        .from("ad_launches")
        .update({ activation_state: activationState, updated_at: new Date().toISOString() })
        .eq("id", launchId)
        .eq("status", "activating")
        .eq("activation_lease_id", leaseId)
        .select("id")
        .maybeSingle();
      if (stateSaveErr || !stateSaved) {
        return NextResponse.json(
          { error: "Activation lease expired; resume to confirm the current Meta state" },
          { status: 409 }
        );
      }
    } catch (err: any) {
      failedAt = level.key;
      failureMessage = err?.message ?? `Failed to activate ${level.key}`;
      break;
    }
  }

  if (failedAt) {
    // A lost ACTIVE response is indistinguishable from failure even though Meta may have applied
    // it. Therefore pause EVERY object with an id, not only levels whose response was recorded.
    // Refund only if all pause calls are positively acknowledged.
    let allPaused = true;
    for (const level of levels) {
      if (level.id) {
        try {
          await setEntityStatus(level.id, token, "PAUSED");
          activationState[level.key] = "paused";
        } catch {
          activationState[level.key] = "pause_unconfirmed";
          allPaused = false;
        }
      }
    }

    if (!allPaused) {
      const retryMessage = `${failureMessage}. Meta pause could not be confirmed; credits remain reserved.`;
      await holdReservationForRetry(admin, launchId, leaseId, retryMessage, activationState);
      return NextResponse.json({ error: retryMessage }, { status: 502 });
    }

    const { error: finalizeErr } = await admin.rpc("finalize_failed_ad_activation", {
      p_launch_id: launchId,
      p_lease_id: leaseId,
      p_notes: failureMessage,
      p_activation_state: activationState,
    });
    if (finalizeErr) {
      await holdReservationForRetry(
        admin,
        launchId,
        leaseId,
        `${failureMessage}. Refund finalization needs retry.`,
        activationState
      );
      return NextResponse.json({ error: "Activation cleanup needs retry" }, { status: 500 });
    }
    return NextResponse.json({ error: failureMessage }, { status: 502 });
  }

  const { data: activated, error: activateStateErr } = await admin
    .from("ad_launches")
    .update({
      status: "active",
      activation_locked_at: null,
      activation_lease_id: null,
      notes: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", launchId)
    .eq("status", "activating")
    .eq("activation_lease_id", leaseId)
    .select("id")
    .maybeSingle();
  if (activateStateErr || !activated) {
    await holdReservationForRetry(
      admin,
      launchId,
      leaseId,
      "Meta is active; local finalization needs retry"
    );
    return NextResponse.json({ error: "Activation finalization needs retry" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
