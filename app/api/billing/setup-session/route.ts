import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Step 2 of signup: save a card, charge nothing.
//
// This is a `mode: 'setup'` Checkout Session, NOT a payment — the 30-day trial is already active
// by the time anyone reaches this route (handle_new_user grants it, 0075), so nothing here gates
// access and nothing here moves money. It exists purely so a card is on file when the trial ends.
//
// `ui_mode: 'embedded'` returns a client_secret instead of a redirect URL, which is what lets the
// card form mount inside step 2 rather than sending someone off-site mid-signup. The card itself
// is entered in Stripe's own iframe — card data never touches this app's DOM, so none of this
// widens PCI scope. Never replace this with hand-rolled card inputs.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  const stripe = getStripe();

  // Reuse the Customer if one exists, so re-running step 2 (a browser refresh, a declined card,
  // adding a card later from Billing) doesn't scatter duplicate Customers across the account.
  let customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name:
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || undefined,
      // The link back to our user. The webhook still reads user_id from session metadata rather
      // than trusting this, but it makes an account findable from the Stripe dashboard.
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    // Persisted immediately, not at webhook time: if the person abandons step 2, the Customer
    // still exists at Stripe and must not be created a second time on their next attempt.
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    ui_mode: "embedded",
    customer: customerId,
    // Card only, deliberately. It keeps `currency` optional (Stripe requires it in setup mode only
    // when payment_method_types is unset) and, more importantly, keeps every redirect-based method
    // off the session — which is the precondition for redirect_on_completion: 'never' below.
    payment_method_types: ["card"],
    // Stay on our page when the card is saved. The alternative bounces the browser to a return_url
    // mid-signup, which is exactly the off-site handoff embedding this form was meant to avoid.
    redirect_on_completion: "never",
    metadata: { user_id: user.id, type: "card_on_file" },
  });

  return NextResponse.json({ clientSecret: session.client_secret });
}
