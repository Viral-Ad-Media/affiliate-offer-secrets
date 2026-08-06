import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { REFERRAL_REWARD_POINTS } from "@/lib/referrals";

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

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const session = event.data.object as {
    id: string;
    amount_total: number | null;
    mode?: string;
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

  // Anything else with metadata we don't recognise is acknowledged, not rejected. A 400 here makes
  // Stripe retry the same event on a schedule for days over something no future retry can fix.
  if (type !== "access" && type !== "credits") {
    return NextResponse.json({ ok: true, ignored: type ?? "unknown" });
  }

  // Idempotency: unique constraint on stripe_session_id — a replayed webhook is a no-op.
  const { error: paymentError } = await admin.from("payments").insert({
    user_id: userId,
    stripe_session_id: session.id,
    type,
    amount_cents: session.amount_total ?? 0,
    status: "completed",
  });
  if (paymentError) {
    if (paymentError.code === "23505") {
      return NextResponse.json({ ok: true, deduped: true });
    }
    return NextResponse.json({ error: paymentError.message }, { status: 500 });
  }

  if (type === "access") {
    await admin.from("profiles").update({ access_granted: true }).eq("id", userId);

    // Referral payout. The access fee is the qualifying event — a referral only earns once the
    // referred account actually pays, which is what makes the program ungameable (a fake signup
    // costs the referrer real money). Safe to run unconditionally: reward_referral is a no-op
    // when this user was never referred or was already rewarded, and it sits after the payments
    // insert above, so a replayed webhook has already short-circuited on the unique constraint.
    const { error: rewardError } = await admin.rpc("reward_referral", {
      p_referred_user_id: userId,
      p_points: REFERRAL_REWARD_POINTS,
    });
    // Never fail the webhook over the reward: access has already been granted, and returning a
    // non-2xx would make Stripe retry a payment that was fully processed.
    if (rewardError) console.error("reward_referral failed", rewardError.message);
  } else {
    const credits = Number(session.metadata?.credits ?? 0);
    if (credits > 0) {
      await admin
        .from("credits_ledger")
        .insert({ user_id: userId, delta: credits, reason: `stripe:${session.id}` });
    }
  }

  return NextResponse.json({ ok: true });
}
