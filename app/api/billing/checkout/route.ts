import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, ACCESS_FEE_CENTS, CREDIT_PACKS } from "@/lib/stripe";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // Capture the host-resolved workspace while the signed-in caller is authorized for it. The
  // webhook must use this immutable target; service_role has no session and must never guess from
  // the user's later memberships.
  const workspaceId = await currentWorkspaceId();
  if (!workspaceId) return workspaceRequiredResponse();

  const body = await req.json();
  // Stripe redirect URLs must come from deployment configuration, never Origin/Host headers.
  // In local development only, req.url is an acceptable fallback so onboarding still works.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (process.env.NODE_ENV !== "production" ? new URL(req.url).origin : "");
  if (!origin) {
    return NextResponse.json({ error: "checkout return URL is not configured" }, { status: 500 });
  }

  let lineItem: { name: string; cents: number; type: "access" | "credits"; credits?: number };
  if (body.type === "access") {
    lineItem = { name: "Affiliate Offer Secrets — Access", cents: ACCESS_FEE_CENTS, type: "access" };
  } else if (body.type === "credits") {
    const pack = CREDIT_PACKS.find((p) => p.credits === Number(body.credits));
    if (!pack) return NextResponse.json({ error: "unknown credit pack" }, { status: 400 });
    lineItem = {
      name: `Affiliate Offer Secrets — ${pack.credits} credits`,
      cents: pack.cents,
      type: "credits",
      credits: pack.credits,
    };
  } else {
    return NextResponse.json({ error: "unknown checkout type" }, { status: 400 });
  }

  const stripe = getStripe();
  const metadata = {
    schema_version: "workspace-v1",
    user_id: user.id,
    workspace_id: workspaceId,
    type: lineItem.type,
    credits: lineItem.credits ? String(lineItem.credits) : "",
    amount_cents: String(lineItem.cents),
  };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: lineItem.cents,
          product_data: { name: lineItem.name },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${origin}/settings/billing?success=1`,
    cancel_url: `${origin}/settings/billing?canceled=1`,
  });

  return NextResponse.json({ url: session.url });
}
