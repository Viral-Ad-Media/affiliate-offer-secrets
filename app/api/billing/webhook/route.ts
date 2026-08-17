import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { REFERRAL_REWARD_POINTS } from "@/lib/referrals";
import { ACCESS_FEE_CENTS, CREDIT_PACKS } from "@/lib/pricing";
import { notify } from "@/lib/notifications";

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

  // Off-session trial conversion (lib/billing/trialConversion.ts). The sweep creates a
  // PaymentIntent and deliberately grants nothing; this is where it becomes access, so the rule
  // that only the Stripe webhook grants access still holds. Handled before the Checkout branch
  // because it carries no session at all.
  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as {
      id: string;
      amount_received?: number | null;
      amount?: number | null;
      currency?: string | null;
      metadata?: Record<string, string> | null;
    };
    if (intent.metadata?.source !== "trial-conversion") {
      // Every Checkout payment also emits this event. Fulfilling here as well would be a second
      // path to the same grant, racing the session handler.
      return NextResponse.json({ ok: true, ignored: "payment_intent (not a trial conversion)" });
    }
    const uid = intent.metadata?.user_id;
    if (!uid) return NextResponse.json({ error: "missing metadata" }, { status: 400 });

    const amount = intent.amount_received ?? intent.amount ?? 0;
    const currency = (intent.currency ?? "").toLowerCase();
    // Same check the Checkout path makes: money moved, but only fulfil what matches a product we
    // can deliver safely. Never infer an entitlement from an amount we didn't ask for.
    if (amount !== ACCESS_FEE_CENTS || currency !== "usd") {
      return NextResponse.json({ error: "trial charge amount or currency mismatch" }, { status: 500 });
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient.rpc("fulfill_trial_charge", {
      p_payment_intent_id: intent.id,
      p_user_id: uid,
      p_amount_cents: amount,
      p_currency: currency,
    });
    // Non-2xx so Stripe retries — the person has paid and does not have access yet, which is the
    // one state worth being noisy about.
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // The SAME qualifying event as a Checkout access payment: the referred account has now paid
    // the access fee. Without this a referral converted by trial would pay in full and the referrer
    // would silently earn nothing — the payout path only ever ran on the Checkout branch, which is
    // the one a converting trial never takes. Idempotent, and non-2xx on failure so Stripe's retry
    // repairs a transient error, exactly as the Checkout path does.
    const { error: rewardError } = await adminClient.rpc("reward_referral", {
      p_referred_user_id: uid,
      p_points: REFERRAL_REWARD_POINTS,
    });
    if (rewardError) {
      console.error("reward_referral failed (trial conversion)", rewardError.message);
      return NextResponse.json({ error: "referral reward failed" }, { status: 500 });
    }

    await notify(adminClient, uid, {
      kind: "billing_succeeded",
      title: "Payment received — your access is active",
      body: "Your trial has converted to a full account. Thanks for using Affiliate Offer Secrets.",
      href: "/settings/billing",
    });
    return NextResponse.json({ ok: true, fulfilled: "trial_conversion" });
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
    customer?: string | { id: string } | null;
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
    // Brand and last four for display, plus the payment method ID so the trial-conversion sweep
    // has something to charge when the 30 days are up.
    //
    // This used to say "this app stores nothing that could charge anything", and that stopped
    // being true the moment trial conversion shipped — a payment method id plus the secret key IS
    // a charge. Still no card data: the number, CVC and expiry never leave Stripe's iframe, so the
    // app remains outside PCI scope. What changed is that a saved card is now chargeable
    // off-session, which is exactly what the signup step promises ("we'll charge you when the trial
    // ends") and what lib/billing/trialConversion.ts does.
    let brand: string | null = null;
    let last4: string | null = null;
    let paymentMethodId: string | null = null;
    try {
      if (session.setup_intent) {
        const intent = await stripe.setupIntents.retrieve(session.setup_intent, {
          expand: ["payment_method"],
        });
        const pm = intent.payment_method;
        if (pm && typeof pm !== "string") {
          paymentMethodId = pm.id;
          brand = pm.card?.brand ?? null;
          last4 = pm.card?.last4 ?? null;
        }
        // Also make it the Customer's default. The sweep prefers the stored id, but a default on
        // the Customer is what any other Stripe-side flow (a future invoice, a manual charge from
        // the dashboard) would reach for — leaving it unset means those silently have no card.
        if (paymentMethodId && typeof session.customer === "string") {
          await stripe.customers.update(session.customer, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
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
      .update({
        card_brand: brand,
        card_last4: last4,
        card_saved_at: new Date().toISOString(),
        // Stored so the trial-conversion sweep has something to charge. Still only an id — never
        // card data — and the sweep re-resolves it against Stripe anyway, because a card can be
        // removed there without this app hearing about it.
        stripe_payment_method_id: paymentMethodId,
      })
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
