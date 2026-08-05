import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/lib/validate";

export const dynamic = "force-dynamic";

// Add one contact by hand. The third way a lead can arrive, after the anonymous bridge-page
// capture (/api/public/leads) and the CSV import — someone you met, replied to, or were given.
//
// Not folded into /api/contacts/import: that route's shape is a parser and a batch, and the
// single-row case would spend all its code path in special-casing. Same reason import doesn't
// reuse /api/public/leads.

const MAX_NAME = 120;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const firstName = typeof body.first_name === "string" ? body.first_name.trim().slice(0, MAX_NAME) : "";
  const tagId = typeof body.tag_id === "string" && body.tag_id ? body.tag_id : null;
  const campaignId = typeof body.campaign_id === "string" && body.campaign_id ? body.campaign_id : null;

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const admin = createAdminClient();

  // A tag id from the body has to belong to this workspace, or a manual add could attach a lead
  // to someone else's tag. Same check the import route does, for the same reason.
  if (tagId) {
    const { data: tag } = await admin
      .from("contact_tags")
      .select("id")
      .eq("id", tagId)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!tag) return NextResponse.json({ error: "tag not found" }, { status: 404 });
  }
  if (campaignId) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  // Workspace-wide on email, deliberately wider than the DB's own guard. The partial unique index
  // is on (campaign_id, lower(email)) and skips rows with no campaign, so it can't be relied on
  // for an unattributed add — and where it does apply it would still let the same person be added
  // twice under two campaigns. One human, one row: attribution is a property of the lead, not a
  // reason to duplicate them. Matches what the CSV import does.
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("workspace_id", ws)
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "That email is already on your list" }, { status: 409 });
  }

  const { data: inserted, error } = await admin
    .from("contacts")
    .insert({
      user_id: user.id,
      // Explicit: this is the admin client, where auth.uid() is NULL, so stamp_workspace_id would
      // otherwise fall back to this user's OWN workspace rather than the one they're looking at.
      workspace_id: ws,
      campaign_id: campaignId,
      first_name: firstName || null,
      email,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (tagId) {
    await admin
      .from("contact_tag_links")
      .upsert(
        { contact_id: inserted!.id, tag_id: tagId, user_id: user.id, workspace_id: ws },
        { onConflict: "contact_id,tag_id", ignoreDuplicates: true }
      );
  }

  return NextResponse.json({ ok: true, id: inserted!.id });
}
