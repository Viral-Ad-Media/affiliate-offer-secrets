import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeJSON, COMPLIANCE_SYSTEM } from "@/lib/engine/anthropic";
import type { FbAdAngle } from "@/lib/shared";
import { captureError } from "@/lib/errorMonitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETARGETING_COUNT = 3;

// Generate RETARGETING ad angles — the "scale the winner" move for warm traffic. These target people
// who already saw the offer and did not buy, so they read differently from the cold angles: they
// acknowledge the prior visit, address the objection that stopped the purchase, and add a reason to
// come back now. Seeded from the campaign's EXISTING cold angles rather than a fresh sales-page
// fetch — those were generated from the sales page, so every claim is already traceable (content
// rule 1) and there is nothing new to invent.
//
// Synchronous + NOT credit-charged, exactly like /api/broadcast/generate: one text call feeding a
// screen the operator is sitting in front of, and every charged action here is keyed on a job id a
// synchronous call doesn't have. Token cost still lands in usage_ledger via completeJSON.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: params.id });
  if (!owns) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  // Read through the RLS client — a campaign in another workspace simply isn't visible.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("fb_ad_angles, email_md, products(product_title)")
    .eq("id", params.id)
    .maybeSingle();

  const coldAngles = (campaign?.fb_ad_angles as FbAdAngle[] | null) ?? null;
  if (!coldAngles || coldAngles.length === 0) {
    return NextResponse.json(
      { error: "Generate the campaign kit's ad angles first — retargeting angles build on them." },
      { status: 400 }
    );
  }

  const productTitle = (campaign as any)?.products?.product_title ?? "this product";
  const emailRef = campaign?.email_md ? String(campaign.email_md).slice(0, 3000) : null;

  const context = [
    `Product: ${productTitle}`,
    `The existing COLD-traffic ad angles for this product (your source of truth for what the sales page supports — do NOT introduce any claim these don't already carry):`,
    coldAngles
      .map((a, i) => `Angle ${i + 1}: ${a.headline} — ${a.primary_text}`)
      .join("\n"),
    emailRef ? `\nExisting email copy for voice reference:\n${emailRef}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `Write ${RETARGETING_COUNT} RETARGETING ad angles for Meta/Facebook. These are shown to people who ALREADY visited this offer's landing page and did NOT buy — a warm audience, not cold traffic.

${context}

Because they've already seen the pitch, retargeting angles do a DIFFERENT job than the cold angles above:
- Acknowledge they were interested / came close, without being creepy about tracking them.
- Address the single most likely objection that stopped the purchase (price, skepticism, timing) using only what the sales page already supports.
- Give a concrete reason to come back NOW — reciprocity, a reminder of what they'd miss, or genuine scarcity ONLY if the offer actually has it. Never fabricate a deadline or a discount.
- Stay distinct from the cold angles; do not just reword them.

Meta compliance (non-negotiable): every claim traceable to what the sales page supports; no invented results, income figures, or cure claims; no personal-attribute callouts ("struggling with X?"); prefer curiosity + mechanism over promise. Keep each headline short (Meta truncates long ones) and each primary_text a tight 1-2 short paragraphs.`;

  try {
    const result = await completeJSON<{ retargeting_angles: FbAdAngle[] }>({
      system: COMPLIANCE_SYSTEM,
      prompt,
      usage: { userId: user.id, jobId: null, jobType: "retargeting_angles", stage: "generate" },
      schema: {
        type: "object",
        properties: {
          retargeting_angles: {
            type: "array",
            minItems: RETARGETING_COUNT,
            maxItems: RETARGETING_COUNT,
            items: {
              type: "object",
              properties: {
                headline: { type: "string" },
                primary_text: { type: "string" },
                description: { type: "string" },
                cta: { type: "string" },
              },
              required: ["headline", "primary_text", "description", "cta"],
            },
          },
        },
        required: ["retargeting_angles"],
      },
    });

    const angles = (result.retargeting_angles ?? []).slice(0, RETARGETING_COUNT);
    if (angles.length === 0) {
      return NextResponse.json({ error: "generation returned nothing — try again" }, { status: 502 });
    }

    // Ownership is already established above; the write goes through the admin client because
    // campaigns is SELECT-only for clients (0009) — same as every other campaign asset write.
    const admin = createAdminClient();
    const { error: writeErr } = await admin
      .from("campaigns")
      .update({ retargeting_angles: angles, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("workspace_id", ws);
    if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, retargeting_angles: angles });
  } catch (err) {
    await captureError("api.retargeting_angles", err, {
      context: { campaign_id: params.id },
      userId: user.id,
      workspaceId: ws,
    });
    const message = err instanceof Error ? err.message : "generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
