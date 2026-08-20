import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type BudgetCheck = {
  allowed: boolean;
  cap: number | null; // null = no cap configured (unlimited)
  spentToday: number;
  remaining: number | null;
};

// The operator-set daily generation credit budget (0119). NULL cap = unlimited (the default), so
// this is a no-op for any workspace that hasn't opted in — matching the standing "no surprise
// ceiling while testing" decision. Called from every generation route BEFORE it queues the charged
// job, with that job's JOB_CREDIT_COST as `addCost`, through the admin client (which the routes
// already hold for their count-cap query and concurrency claim).
//
// Fail-OPEN on any read error: a transient DB hiccup must not block a paying operator's generation.
// The credit BALANCE (charged at queue time) is the hard ceiling regardless; this is a rate limit
// layered on top, not the thing standing between a zero balance and a spend.
export async function checkGenerationBudget(
  admin: AdminClient,
  workspaceId: string,
  addCost: number
): Promise<BudgetCheck> {
  const { data: ws, error: wsErr } = await admin
    .from("workspaces")
    .select("daily_generation_credit_cap")
    .eq("id", workspaceId)
    .maybeSingle();

  const cap = (ws?.daily_generation_credit_cap as number | null | undefined) ?? null;
  if (wsErr || cap == null) {
    return { allowed: true, cap: null, spentToday: 0, remaining: null };
  }

  const { data: spent, error: spendErr } = await admin.rpc("workspace_generation_spend_today", {
    p_workspace_id: workspaceId,
  });
  if (spendErr) {
    return { allowed: true, cap, spentToday: 0, remaining: cap }; // fail open on the read
  }

  const spentToday = Number(spent ?? 0);
  const remaining = Math.max(0, cap - spentToday);
  return { allowed: spentToday + addCost <= cap, cap, spentToday, remaining };
}

// A ready-to-return message for a route that hit the cap. The route turns this into a 429/402.
export function budgetExceededMessage(check: BudgetCheck): string {
  return `Daily generation budget reached — ${check.spentToday}/${check.cap} credits used in the last 24h. Raise or clear the cap in Settings → Preferences, or wait for it to roll off.`;
}
