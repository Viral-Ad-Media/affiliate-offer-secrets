import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { themePresetById, sanitizeTheme, THEME_PRESETS } from "@/lib/engine/pageTheme";
import { contentWidthOf } from "@/lib/engine/renderPages";

export const dynamic = "force-dynamic";

/**
 * Restyle a funnel without regenerating a word of it.
 *
 * This is the answer to "I want it to look different" that does NOT cost credits and does NOT
 * touch copy: a preset only writes `page_copy.theme`, which the renderer turns into CSS custom
 * properties. Blocks are read and written back untouched — no section is added, removed or
 * reordered — so this is safe on a page somebody hand-wrote, which is exactly what regenerating
 * the funnel page is not.
 *
 * Deliberately NOT the same thing as lib/funnelStyles.ts: a FUNNEL STYLE decides which sections
 * exist, so applying one to an existing page would drop the copy in the sections it omits. That's
 * a create-time choice and it stays one.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const campaignId = params.id;
  const body = await req.json().catch(() => ({}));

  const preset = themePresetById(body.preset);
  if (!preset) {
    return NextResponse.json(
      { error: `Unknown style. Expected one of: ${THEME_PRESETS.map((p) => p.id).join(", ")}` },
      { status: 400 }
    );
  }

  // Ownership through the RLS-scoped client — campaigns is select-only for clients, so a row
  // coming back here is already proof of membership. The write below needs the admin client.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, page_copy")
    .eq("id", campaignId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const tree = (campaign.page_copy ?? null) as Record<string, unknown> | null;
  if (!tree || !Array.isArray(tree.blocks)) {
    return NextResponse.json(
      { error: "This funnel has no editable page yet — build or create one first." },
      { status: 400 }
    );
  }

  // Blocks are carried across by reference and never inspected: the ONLY key that changes is
  // `theme`. Width is re-clamped rather than dropped so a page that set one keeps it.
  const next = {
    ...tree,
    contentWidth: contentWidthOf(tree),
    // Through sanitizeTheme like any other theme write — a preset is a convenience, not a trusted
    // path into the stylesheet. `{}` (the Original preset) clears back to the stock look.
    theme: sanitizeTheme(preset.theme) ?? undefined,
  };

  const admin = createAdminClient();
  const { error: updateErr } = await admin
    .from("campaigns")
    .update({ page_copy: next, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Hrefs and now theme CSS are baked into stored HTML at write time, so the page has to be
  // re-rendered or the published funnel keeps its old look while the editor claims otherwise.
  // Re-renders the opt-in page, every non-control variant, and every step in one pass.
  const result = await rerenderFunnelSequence(admin, campaignId, ws);

  return NextResponse.json({ ok: true, preset: preset.id, rerendered: result ?? null });
}
