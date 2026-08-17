import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { funnelPublishBlockers } from "@/lib/funnelPublishGate";
import { themePresetById, sanitizeTheme, THEME_PRESETS } from "@/lib/engine/pageTheme";
import { contentWidthOf } from "@/lib/engine/blockTree";

export const dynamic = "force-dynamic";
// Restyle re-renders every page of every selected funnel; publish runs a checklist plus a step
// query each. Both are per-funnel work, so the batch cap below is what actually bounds the time.
export const maxDuration = 60;

// Not a security limit — the ownership filter is — but an unbounded id array is an unbounded IN
// clause, and the list only ever selects what it rendered.
const MAX_BATCH = 50;

const ACTIONS = ["publish", "unpublish", "restyle", "archive", "unarchive", "delete"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Bulk actions over selected funnels.
 *
 * The load-bearing detail, identical to /api/contacts/bulk and /api/blog/posts/bulk: every write
 * runs on the admin client, which bypasses RLS, and the ids come from the request body. So they
 * are re-resolved against the caller's workspace FIRST and only that verified set is touched. Ids
 * from another workspace are silently dropped, never acted on. "The UI only sends ids it rendered"
 * is not an authorization argument.
 *
 * ARCHIVE is the prominent action and DELETE is the guarded one, because a campaign row is the
 * whole KIT — ad angles, TikTok scripts, the email sequence, the blog source, every step and
 * variant — not just the funnel page. "Delete this funnel" therefore destroys work that has
 * nothing to do with the funnel, which is almost never what someone finishing a campaign means.
 * Delete requires an explicit `confirm: true` in the body: not a security control (the caller
 * supplies it) but a guarantee that no client can reach it by getting an action string slightly
 * wrong, and a place to state the blast radius in one spot.
 *
 * Deleting also UNPUBLISHES by construction — the row is gone, so servePublicCampaignPage finds
 * nothing and answers its ordinary 404. Nothing is left half-live.
 *
 * PUBLISH runs the same gate as pressing publish once (lib/funnelPublishGate.ts), per funnel, and
 * reports what it refused. A bulk path that skipped the checklist would be strictly more
 * permissive than the button it stands in for.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const rawIds: unknown = body.campaign_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "no funnels selected" }, { status: 400 });
  }
  if (rawIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `Select at most ${MAX_BATCH} funnels at a time` }, { status: 400 });
  }
  const requested = Array.from(new Set(rawIds.filter((v): v is string => typeof v === "string")));
  if (requested.length === 0) {
    return NextResponse.json({ error: "no funnels selected" }, { status: 400 });
  }

  // THE authorization step. Everything below operates on `ids`, never on `requested`.
  const { data: owned, error: ownErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("workspace_id", ws)
    .in("id", requested);
  if (ownErr) return NextResponse.json({ error: ownErr.message }, { status: 500 });
  const ids = (owned ?? []).map((r) => r.id as string);
  if (ids.length === 0) return NextResponse.json({ error: "no funnels found" }, { status: 404 });

  const admin = createAdminClient();

  if (action === "unpublish") {
    // Never gated. Taking live pages DOWN must always work — the one thing worse than an
    // incomplete published page is one you can't retract, and that is doubly true in bulk.
    const { error } = await admin.from("campaigns").update({ bridge_published: false }).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action, updated: ids.length, skipped: [] });
  }

  if (action === "archive" || action === "unarchive") {
    // Archiving deliberately does NOT unpublish. They answer different questions — "am I still
    // working on this" versus "is this public" — and silently pulling live pages down while
    // someone tidied a list would take real ad traffic offline with nothing saying so. The list
    // flags an archived funnel that is still published rather than resolving it here.
    const { error } = await admin
      .from("campaigns")
      .update({ archived_at: action === "archive" ? new Date().toISOString() : null })
      .in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action, updated: ids.length, skipped: [] });
  }

  if (action === "delete") {
    if (body.confirm !== true) {
      return NextResponse.json(
        {
          error:
            "Deleting a funnel deletes its whole campaign kit — ad angles, emails, the blog source, every step. Archive it instead, or confirm.",
        },
        { status: 400 }
      );
    }
    // FKs do the rest, and the split was read from the catalog rather than assumed. CASCADE:
    // funnel_steps, bridge_variants, campaign_creatives, ad_launches, tiktok_ad_launches,
    // social_drafts, custom_domain_routes. SET NULL: contacts, blog_posts, broadcast_*, and every
    // posting/sending audit table — so captured leads and published articles survive as the
    // history they are. That split is the schema's decision; nothing here overrides it.
    //
    // KNOWN GAP: campaign_creatives cascades its ROWS, but the mp4s those rows point at live in
    // the private `campaign-videos` Storage bucket and are not reachable by an FK, so they are
    // orphaned. The account-deletion route sweeps Storage explicitly for exactly this reason; a
    // per-campaign sweep belongs here too and is not built. Wasted bytes only — nothing is served
    // from an orphaned object, since every URL for one is minted on demand from a live row.
    const { error } = await admin.from("campaigns").delete().in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action, updated: ids.length, skipped: [] });
  }

  if (action === "publish") {
    let updated = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const { notReady, missing } = await funnelPublishBlockers(admin, id);
      if (notReady) {
        skipped.push({ id, reason: "the kit hasn't finished building" });
        continue;
      }
      if (missing.length > 0) {
        // The first missing item, not all of them: a bulk result listing every gap on every funnel
        // is unreadable, and the funnel's own page shows the full checklist.
        skipped.push({ id, reason: missing[0] });
        continue;
      }
      const { error } = await admin.from("campaigns").update({ bridge_published: true }).eq("id", id);
      if (error) skipped.push({ id, reason: error.message });
      else updated++;
    }
    // Partial success is reported as success WITH the refusals, not as an error. Some funnels did
    // go live, and answering 400 would invite a retry that republishes them.
    return NextResponse.json({ ok: true, action, updated, skipped });
  }

  // restyle
  const preset = themePresetById(body.preset);
  if (!preset) {
    return NextResponse.json(
      { error: `Unknown style. Expected one of: ${THEME_PRESETS.map((p) => p.id).join(", ")}` },
      { status: 400 }
    );
  }

  let updated = 0;
  const skipped: { id: string; reason: string }[] = [];
  const { data: rows } = await admin.from("campaigns").select("id, page_copy").in("id", ids);
  for (const row of rows ?? []) {
    const tree = (row.page_copy ?? null) as Record<string, unknown> | null;
    if (!tree || !Array.isArray(tree.blocks)) {
      skipped.push({ id: row.id as string, reason: "no editable page yet" });
      continue;
    }
    // Blocks carried across BY REFERENCE and never inspected — the only key that changes is
    // `theme`, which is what makes restyle the non-destructive alternative to regenerating.
    const next = {
      ...tree,
      contentWidth: contentWidthOf(tree),
      theme: sanitizeTheme(preset.theme) ?? undefined,
    };
    const { error } = await admin
      .from("campaigns")
      .update({ page_copy: next, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      skipped.push({ id: row.id as string, reason: error.message });
      continue;
    }
    // Theme CSS is baked into stored HTML at write time, so without this the published funnel
    // keeps its old look while the editor claims otherwise. Counted, not thrown: the page_copy is
    // already saved by here, and failing the request would misreport what happened.
    try {
      await rerenderFunnelSequence(admin, row.id as string, ws);
      updated++;
    } catch (e: any) {
      skipped.push({ id: row.id as string, reason: `saved, but re-render failed: ${e?.message ?? e}` });
    }
  }

  return NextResponse.json({ ok: true, action, preset: preset.id, updated, skipped });
}
