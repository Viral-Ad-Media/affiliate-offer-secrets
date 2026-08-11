import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { REFERRAL_REWARD_POINTS } from "@/lib/referrals";
import { ACCESS_FEE_CENTS, CREDIT_PACKS } from "@/lib/pricing";

export const dynamic = "force-dynamic";

// Stripe webhook — the ONLY place that grants access or adds credits. Verifies the Stripe
// signature (never trust an unsigned request), then writes via the admin client since this
// runs with no user session (RLS would otherwise block it).
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: "missing signature/secret" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return NextResponse.json({ error: `invalid signature: ${err}` }, { status: 400 });
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const session = event.data.object as {
    id: string;
    amount_total: number | null;
    currency?: string | null;
    mode?: string;
    payment_status?: string;
    payment_intent?: string | { id: string } | null;
    setup_intent?: string | null;
    metadata: Record<string, string> | null;
  };
  const userId = session.metadata?.user_id;
  const type = session.metadata?.type;
  if (!userId) {
    return NextResponse.json({ error: "missing metadata" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Signup step 2: a card was saved, nothing was charged. Handled BEFORE the payments insert and
  // returned from early, because none of what follows applies — there is no amount, it must not
  // write a `payments` row (that table is the paid-money audit trail and the referral program's
  // qualifying event reads from this same handler), and it must not grant access. A card on file
  // is not a purchase.
  if (type === "card_on_file" || session.mode === "setup") {
    // Only ever the brand and last four, echoed back for display on the billing page. Stripe keeps
    // the payment method; this app stores nothing that could charge anything.
    let brand: string | null = null;
    let last4: string | null = null;
    try {
      if (session.setup_intent) {
        const intent = await stripe.setupIntents.retrieve(session.setup_intent, {
          expand: ["payment_method"],
        });
        const pm = intent.payment_method;
        if (pm && typeof pm !== "string" && pm.card) {
          brand = pm.card.brand ?? null;
          last4 = pm.card.last4 ?? null;
        }
      }
    } catch (err) {
      // The card IS saved at Stripe by this point — the only thing that failed is reading its
      // display label. Swallow it rather than returning non-2xx, which would make Stripe retry a
      // setup that already succeeded.
      console.error("card_on_file: could not read payment method", err);
    }

    await admin
      .from("profiles")
      .update({ card_brand: brand, card_last4: last4, card_saved_at: new Date().toISOString() })
      .eq("id", userId);

    return NextResponse.json({ ok: true, saved: "card_on_file" });
  }

  // Anything else with metadata we don't recognise is acknowledged. Checkout Sessions can only be
  // created by server routes, so this is an old/non-product session rather than caller-controlled
  // fulfillment input.
  if (type !== "access" && type !== "credits") {
    return NextResponse.json({ ok: true, ignored: type ?? "unknown" });
  }

  // A completed Checkout Session is not necessarily paid when asynchronous methods are enabled.
  // New sessions are card-only, but this also handles older sessions without ever granting against
  // an unpaid completion event.
  if (session.payment_status !== "paid") {
    return NextResponse.json({ ok: true, pending: true });
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) {
    return NextResponse.json({ error: "paid checkout is missing a payment intent" }, { status: 500 });
  }

  const amountCents = session.amount_total ?? 0;
  const currency = (session.currency ?? "").toLowerCase();
  const credits = type === "credits" ? Number(session.metadata?.credits ?? 0) : null;
  const expectedAmount =
    type === "access"
      ? ACCESS_FEE_CENTS
      : CREDIT_PACKS.find((pack) => pack.credits === credits)?.cents;
  const metadataAmount = Number(session.metadata?.amount_cents ?? expectedAmount);
  if (
    !expectedAmount ||
    amountCents !== expectedAmount ||
    metadataAmount !== expectedAmount ||
    currency !== "usd"
  ) {
    // Money moved but the signed session no longer matches a product we can fulfill safely. Keep
    // this non-2xx so Stripe retries and operators see it; never guess an entitlement or amount.
    return NextResponse.json({ error: "checkout amount or currency mismatch" }, { status: 500 });
  }

  // New sessions carry the host-resolved workspace. For sessions created before this deployment,
  // the only safe fallback is exactly one membership; multiple/zero memberships become an
  // idempotent refund through the RPC below.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const signedWorkspace = session.metadata?.workspace_id;
  let workspaceId = signedWorkspace && UUID_RE.test(signedWorkspace) ? signedWorkspace : null;
  if (!workspaceId && session.metadata?.schema_version !== "workspace-v1") {
    const { data: memberships, error: membershipsError } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(2);
    if (membershipsError) {
      return NextResponse.json({ error: membershipsError.message }, { status: 500 });
    }
    if (memberships?.length === 1) workspaceId = memberships[0].workspace_id;
  }

  // The database function is the transaction boundary: payment audit + access/credit delivery
  // commit together, and a replay only observes the already-completed result. Missing checkout
  // targets are recorded as refund_pending without falling back to another workspace.
  const { data: fulfillment, error: fulfillmentError } = await admin.rpc(
    "fulfill_stripe_checkout",
    {
      p_stripe_session_id: session.id,
      p_stripe_payment_intent_id: paymentIntentId,
      p_user_id: userId,
      p_workspace_id: workspaceId,
      p_type: type,
      p_amount_cents: amountCents,
      p_currency: currency,
      p_credit_units: credits,
    }
  );
  if (fulfillmentError) {
    return NextResponse.json({ error: fulfillmentError.message }, { status: 500 });
  }

  const fulfillmentStatus = (fulfillment as { status?: string } | null)?.status;
  if (fulfillmentStatus === "refund_pending") {
    try {
      await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey: `orphaned-checkout:${session.id}` }
      );
    } catch (err: any) {
      console.error("Stripe orphaned-checkout refund failed", session.id, err?.message ?? err);
      return NextResponse.json({ error: "checkout refund failed" }, { status: 500 });
    }

    const { error: markRefundError } = await admin.rpc("mark_stripe_checkout_refunded", {
      p_stripe_session_id: session.id,
      p_stripe_payment_intent_id: paymentIntentId,
    });
    if (markRefundError) {
      return NextResponse.json({ error: markRefundError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, refunded: true });
  }

  if (fulfillmentStatus === "refunded") {
    return NextResponse.json({ ok: true, deduped: true, refunded: true });
  }
  if (fulfillmentStatus !== "completed") {
    return NextResponse.json({ error: "unknown checkout fulfillment state" }, { status: 500 });
  }

  if (type === "access") {

    // Referral payout. The access fee is the qualifying event — a referral only earns once the
    // referred account actually pays, which is what makes the program ungameable (a fake signup
    // costs the referrer real money). It is independently idempotent, and we run it after both new
    // and deduped fulfillment so a transient reward error can be repaired by Stripe's retry.
    const { error: rewardError } = await admin.rpc("reward_referral", {
      p_referred_user_id: userId,
      p_points: REFERRAL_REWARD_POINTS,
    });
    if (rewardError) {
      console.error("reward_referral failed", rewardError.message);
      return NextResponse.json({ error: "referral reward failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, deduped: Boolean((fulfillment as any)?.deduped) });
}
