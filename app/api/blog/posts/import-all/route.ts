import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPostFromCampaign } from "@/lib/blog/fromCampaign";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Backfill: a draft post for every one of the caller's campaigns whose kit already contains an
// article. New builds create their post automatically (lib/engine/worker.ts), so this exists for
// the campaigns built before that shipped — and as a repair for any build whose post creation
// failed (it's best-effort there by design).
//
// createPostFromCampaign is idempotent on campaign_id, so running this repeatedly is safe: already
// -imported campaigns come back as skipped rather than duplicated.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  // RLS-scoped read — the caller's campaigns only. Campaigns that errored mid-build can still
  // hold a finished article (the content stage runs before the ones that failed), and that draft
  // is worth having, so the filter is "has an article", not "status = ready".
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id")
    .not("blog_md", "is", null)
    .order("created_at");

  const admin = createAdminClient();
  let created = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const c of campaigns ?? []) {
    try {
      const result = await createPostFromCampaign(admin, ws as string, c.id as string);
      if (result.created) created++;
      else skipped++;
    } catch (err: any) {
      // One bad campaign shouldn't abandon the rest of the backfill.
      failed.push(c.id as string);
      console.error("import-all failed for campaign", c.id, err);
    }
  }

  return NextResponse.json({ ok: true, created, skipped, failed: failed.length });
}
