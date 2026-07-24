import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, ACCESS_FEE_CENTS, CREDIT_PACKS } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json();
  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  let lineItem: { name: string; cents: number; type: "access" | "credits"; credits?: number };
  if (body.type === "access") {
    lineItem = { name: "ClickBank Studio — Access", cents: ACCESS_FEE_CENTS, type: "access" };
  } else if (body.type === "credits") {
    const pack = CREDIT_PACKS.find((p) => p.credits === Number(body.credits));
    if (!pack) return NextResponse.json({ error: "unknown credit pack" }, { status: 400 });
    lineItem = {
      name: `ClickBank Studio — ${pack.credits} credits`,
      cents: pack.cents,
      type: "credits",
      credits: pack.credits,
    };
  } else {
    return NextResponse.json({ error: "unknown checkout type" }, { status: 400 });
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
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
    metadata: {
      user_id: user.id,
      type: lineItem.type,
      credits: lineItem.credits ? String(lineItem.credits) : "",
    },
    success_url: `${origin}/billing?success=1`,
    cancel_url: `${origin}/billing?canceled=1`,
  });

  return NextResponse.json({ url: session.url });
}
