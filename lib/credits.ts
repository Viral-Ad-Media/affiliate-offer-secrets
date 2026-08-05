// What each kind of work costs the customer, in credits (1 credit ≈ $1, the same unit the Stripe
// top-up packs sell and the same unit ad-spend authorisation uses).
//
// THIS TABLE IS THE PRICE LIST — it is the one place to change what anything costs, and it is
// deliberately a plain literal so that reading it tells you the whole pricing model. The numbers
// below are a STARTING POINT chosen to sit comfortably above real marginal cost, not a modelled
// margin: a discovery run is one Anthropic call, a campaign build is roughly eight across six
// stages, an image is a few cents at kie.ai, and a Veo video is the only line item that costs real
// dollars per unit. Revisit before opening this beyond solo testing.
//
// Two entries are 0 ON PURPOSE, and neither is an oversight:
//   launch_ad          — the ad's budget is already reserved against the same ledger by
//                        reserve_ad_credits() at activation. Charging to queue the draft as well
//                        would bill twice for one action, and drafts are deliberately free so a
//                        client can build and compare a few angles before committing (Phase C).
//   send_broadcast_email — governed by the pooled daily send cap, which exists to protect a real
//                        mailbox from being flagged. A per-email credit price would be a second,
//                        unrelated limiter on the same action.
export const JOB_CREDIT_COST = {
  discover_products: 1,
  build_campaign: 5,
  generate_ad_image: 2,
  generate_creative_image: 2,
  generate_blog_image: 2,
  generate_video: 10,
  generate_creative_video: 10,
  launch_ad: 0,
  send_broadcast_email: 0,
} as const;

export type ChargeableJobType = keyof typeof JOB_CREDIT_COST;

export function creditCostFor(jobType: string): number {
  return JOB_CREDIT_COST[jobType as ChargeableJobType] ?? 0;
}

/** "5 credits" / "1 credit" / "Free" — for buttons and confirmations. */
export function formatCost(credits: number): string {
  if (credits <= 0) return "Free";
  return `${credits} credit${credits === 1 ? "" : "s"}`;
}

export type ChargeResult =
  | { ok: true; charged: number; balance: number }
  | { ok: false; reason: "insufficient"; cost: number }
  | { ok: false; reason: "error"; message: string };

// Minimal shape of a supabase-js client, so this module stays isomorphic and testable — the caller
// passes whichever client it already holds rather than this file importing a server-only one.
// PromiseLike, not Promise: supabase-js's .rpc() returns a PostgrestFilterBuilder that is only
// thenable, so requiring a real Promise here rejects every real client.
type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: any; error: { message: string } | null }>;
};

/**
 * Charge a job that has ALREADY been inserted.
 *
 * Ordering matters and is not arbitrary: the charge is keyed on the job's own id, so the row has to
 * exist first. That leaves a brief window where the insert trigger may have already woken the
 * worker for a job we are about to cancel — accepted, because the alternative (charge first
 * against a client-chosen id) would let a caller mint the primary key of a row only the admin
 * client writes, a pattern nothing else in this codebase allows. Callers MUST delete the job when
 * this returns `insufficient`; see the routes for that pairing.
 *
 * Idempotent: charge_job_credits swallows a duplicate and returns the current balance, so a
 * retried request cannot debit twice, and neither can a future caller that forgets.
 */
export async function chargeForQueuedJob(
  client: RpcClient,
  jobId: string,
  jobType: string,
  label?: string
): Promise<ChargeResult> {
  const cost = creditCostFor(jobType);
  if (cost === 0) return { ok: true, charged: 0, balance: Number.NaN };

  const reason = label ? `${jobType}: ${label}` : jobType;
  const { data, error } = await client.rpc("charge_job_credits", {
    p_job_id: jobId,
    p_amount: cost,
    p_reason: reason,
  });

  if (error) return { ok: false, reason: "error", message: error.message };
  // NULL back means "cannot afford it" — a real answer, not a failure.
  if (data === null || data === undefined) return { ok: false, reason: "insufficient", cost };
  return { ok: true, charged: cost, balance: Number(data) };
}

/** The 402 body every queueing route returns, so the message is identical everywhere. */
export function insufficientCreditsResponse(cost: number) {
  return {
    error: `Not enough credits — this costs ${formatCost(cost)}. Top up on the billing page.`,
    needed: cost,
    code: "insufficient_credits" as const,
  };
}

type QueueClient = RpcClient & {
  from(table: string): any;
};

export type QueueOutcome =
  | { ok: true; jobId: string; charged: number }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Insert a job and charge for it, undoing the insert if the workspace can't afford it.
 *
 * Every queueing route goes through this so the insert/charge/rollback triple can't drift apart —
 * a route that inserted without charging would silently give work away, and one that charged
 * without deleting on failure would bill for a job that never runs. `onRollback` exists for the
 * two routes that take a concurrency claim before queueing (campaigns.video_status,
 * claim_campaign_creative): the claim has to be released too, or the entity is stuck "generating"
 * forever after a declined charge.
 */
export async function queueChargedJob(
  client: QueueClient,
  job: { user_id: string; type: string; payload: Record<string, unknown> },
  opts: { label?: string; onRollback?: () => Promise<void> } = {}
): Promise<QueueOutcome> {
  const { data: row, error } = await client
    .from("jobs")
    .insert({ user_id: job.user_id, type: job.type, payload: job.payload })
    .select("id")
    .single();

  if (error || !row?.id) {
    await opts.onRollback?.();
    return { ok: false, status: 500, body: { error: error?.message ?? "Could not queue the job" } };
  }

  const charge = await chargeForQueuedJob(client, row.id, job.type, opts.label);

  if (!charge.ok) {
    // The job must not survive a failed charge — the trigger may already have woken the worker,
    // so deleting it is what actually stops the work from being done for free.
    await client.from("jobs").delete().eq("id", row.id);
    await opts.onRollback?.();
    return charge.reason === "insufficient"
      ? { ok: false, status: 402, body: insufficientCreditsResponse(charge.cost) }
      : { ok: false, status: 500, body: { error: charge.message } };
  }

  return { ok: true, jobId: row.id, charged: charge.charged };
}
