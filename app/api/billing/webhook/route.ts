import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

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
    metadata: Record<string, string> | null;
  };
  const userId = session.metadata?.user_id;
  const type = session.metadata?.type;
  if (!userId || (type !== "access" && type !== "credits")) {
    return NextResponse.json({ error: "missing metadata" }, { status: 400 });
  }

  const admin = createAdminClient();

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
