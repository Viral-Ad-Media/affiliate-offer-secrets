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

/** The 402 body every queueing route returns, so the message is identical everywhere. */
export function insufficientCreditsResponse(cost: number) {
  return {
    error: `Not enough credits — this costs ${formatCost(cost)}. Top up on the billing page.`,
    needed: cost,
    code: "insufficient_credits" as const,
  };
}

export type QueueOutcome =
  | { ok: true; jobId: string; charged: number; deduped: boolean }
  | { ok: false; status: number; body: Record<string, unknown> };

type QueueRpcResult = {
  ok: boolean;
  job_id?: string;
  charged?: number;
  balance?: number;
  code?: string;
  needed?: number;
  deduped?: boolean;
};

/**
 * Atomically queue and (when non-free) charge for a job.
 *
 * queue_job() derives the price in SQL, validates every referenced row against the explicit
 * workspace, and writes the ledger debit plus pending job in one transaction. The insert trigger
 * cannot expose a runnable unpaid row: another transaction only sees the job after the debit has
 * committed too. `onRollback` preserves the existing pre-queue entity claims when the RPC rejects
 * or cannot queue video, creative, or blog-image work.
 */
export async function queueChargedJob(
  client: RpcClient,
  job: {
    workspace_id: string;
    type: Exclude<ChargeableJobType, "send_broadcast_email">;
    payload: Record<string, unknown>;
  },
  opts: { onRollback?: () => Promise<void> } = {}
): Promise<QueueOutcome> {
  const { data, error } = await client.rpc("queue_job", {
    p_workspace_id: job.workspace_id,
    p_type: job.type,
    p_payload: job.payload,
  });

  if (error) {
    await opts.onRollback?.();
    return { ok: false, status: 500, body: { error: error.message } };
  }

  const result = data as QueueRpcResult | null;
  if (!result?.ok) {
    await opts.onRollback?.();
    if (result?.code === "insufficient_credits") {
      return {
        ok: false,
        status: 402,
        body: insufficientCreditsResponse(Number(result.needed ?? creditCostFor(job.type))),
      };
    }
    return { ok: false, status: 500, body: { error: "Could not queue the job" } };
  }

  if (!result.job_id) {
    await opts.onRollback?.();
    return { ok: false, status: 500, body: { error: "Queue returned no job id" } };
  }

  return {
    ok: true,
    jobId: result.job_id,
    charged: Number(result.charged ?? 0),
    deduped: result.deduped === true,
  };
}
