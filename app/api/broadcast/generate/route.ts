import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { completeJSON, COMPLIANCE_SYSTEM } from "@/lib/engine/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ANGLE_CHARS = 400;

// Draft a broadcast email with AI, as an alternative to writing it by hand. Synchronous rather
// than a queued job: this is one Anthropic call feeding a composer the person is sitting in front
// of, and a job would mean writing an email, waiting, and coming back.
//
// NOT credit-charged, deliberately. Every charged action in this app is keyed on a job id, and
// that key is exactly what makes charging safe — it is what stops a double-click or a worker retry
// from debiting twice. A synchronous helper has no such key, so charging it would introduce a
// second, weaker billing path for one cheap text call. The token cost is still recorded in
// usage_ledger by completeJSON, same as every other Anthropic call in the app. If this ever needs
// a price, give it a client-supplied idempotency key first (the meta_posts pattern), don't just
// bolt on an unguarded debit.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;
  const angle =
    typeof body.angle === "string" ? body.angle.trim().slice(0, MAX_ANGLE_CHARS) : "";

  // Campaign context is optional — someone may just want a broadcast about nothing in particular.
  // When given, it is read through the RLS-scoped client, so a campaign belonging to another
  // workspace simply isn't visible and the request degrades to the no-context path rather than
  // leaking a title. Same implicit-ownership idiom the other campaign-scoped routes use.
  let productTitle: string | null = null;
  let hoplink: string | null = null;
  let toneReference: string | null = null;

  if (campaignId) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("email_md, products(product_title, hoplink)")
      .eq("id", campaignId)
      .maybeSingle();
    const product = (campaign as any)?.products;
    productTitle = product?.product_title ?? null;
    hoplink = product?.hoplink ?? null;
    // The kit's existing email sequence is the best available guide to this offer's voice.
    toneReference = campaign?.email_md ? String(campaign.email_md).slice(0, 4000) : null;
  }

  const context = [
    productTitle ? `Product being promoted: ${productTitle}` : null,
    hoplink ? `Affiliate link to use for the call to action: ${hoplink}` : null,
    angle ? `What this email should be about: ${angle}` : null,
    toneReference
      ? `Existing email copy for this offer, as a guide to voice and claims — do NOT copy it verbatim, and do not introduce any claim it doesn't already support:\n${toneReference}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `Write ONE broadcast email to a list of subscribers who previously opted in through a landing page.

${context || "No specific product context was given — write a short, useful email the list owner can adapt."}

Requirements:
- A subject line that earns the open through curiosity or specific usefulness, never a promise of results. No ALL CAPS, no "RE:" or "FWD:" fakery, no false urgency.
- Body in Markdown. Short paragraphs. One clear call to action.
- Write to one person, not to "everyone".
- Do NOT invent results, income figures, testimonials, timeframes or health claims. Every claim must be supported by the material above; if there is nothing to support a claim, leave the claim out.
- Do NOT write an unsubscribe line, footer, or any legal boilerplate — the platform appends its own and a second one is a bug, not a nicety.
- Do not include the subject line inside the body.`;

  try {
    const result = await completeJSON<{ subject: string; body_md: string }>({
      system: COMPLIANCE_SYSTEM,
      prompt,
      maxTokens: 2000,
      toolName: "emit_broadcast_email",
      schema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Subject line, under 80 characters" },
          body_md: { type: "string", description: "Email body in Markdown, no unsubscribe footer" },
        },
        required: ["subject", "body_md"],
        additionalProperties: false,
      },
      usage: { userId: user.id, jobId: null, jobType: "broadcast_generate", stage: "draft" },
    });

    return NextResponse.json({
      ok: true,
      subject: (result.subject ?? "").trim(),
      body_md: (result.body_md ?? "").trim(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not draft the email" },
      { status: 502 }
    );
  }
}
