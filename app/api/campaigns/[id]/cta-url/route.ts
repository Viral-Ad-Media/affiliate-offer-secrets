import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { isValidRedirectUrl } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Where a standalone funnel's call to action goes.
 *
 * Only meaningful without a product: with one, the hoplink wins and this stays null, so there is
 * one source of truth for the destination rather than two competing ones (see offerHref() in
 * lib/funnelSteps.ts).
 *
 * The URL is BAKED into stored HTML — the opt-in page and every step have their hrefs resolved at
 * write time, not at serve time — so saving it is only half the job. Without the re-render below,
 * published pages would keep sending real traffic to the old destination while the UI claimed
 * otherwise. Same reason the hoplink-override route re-renders.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: params.id });
  if (!owns) return NextResponse.json({ error: "funnel not found" }, { status: 404 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const raw = typeof body.cta_url === "string" ? body.cta_url.trim() : "";

  // Empty clears it — "no destination yet" is a real state, and the page renders a dead "#" rather
  // than sending someone somewhere unintended.
  let ctaUrl: string | null = null;
  if (raw) {
    if (!isValidRedirectUrl(raw)) {
      return NextResponse.json({ error: "Enter a full URL starting with http:// or https://" }, { status: 400 });
    }
    ctaUrl = raw;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("campaigns")
    .update({ cta_url: ctaUrl, updated_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await rerenderFunnelSequence(admin, params.id, ws);

  return NextResponse.json({ ok: true, cta_url: ctaUrl });
}
