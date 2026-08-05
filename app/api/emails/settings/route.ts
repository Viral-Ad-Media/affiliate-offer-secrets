import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/lib/validate";
import { normalizeEmailSettings, EMAIL_SETTINGS_COLUMNS } from "@/lib/emailSettings";

export const dynamic = "force-dynamic";

// Sender identity: reply-to, business name, postal address, footer note. Writes go through the
// admin client because email_settings is owner-select with no client write grants, same as every
// domain table since 0009.
export async function PATCH(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const patch = normalizeEmailSettings(body as Record<string, unknown>);

  // Reply-to is the one field with a real format: it becomes a header on live mail, and a
  // malformed one makes replies bounce silently rather than erroring anywhere visible. Blank is
  // fine (it just means "replies go to the from-address"), a malformed value is not.
  if (patch.reply_to && !isValidEmail(patch.reply_to)) {
    return NextResponse.json({ error: "Reply-to must be a valid email address" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_settings")
    .upsert({ workspace_id: ws, ...patch, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" })
    .select(EMAIL_SETTINGS_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, settings: data });
}
