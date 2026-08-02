import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendViaActiveSender, isSendFailure } from "@/lib/mail/send";

export const dynamic = "force-dynamic";

// This route never operates on another tenant's resource — the mailbox used is always the
// caller's own active mail provider (user_id = auth.uid()), and to/subject/html are
// freeform values the caller controls for their own send. No foreign resource-id parameter, so
// none of the cross-tenant-IDOR pattern seen elsewhere (Page IDs, IG account IDs) applies here.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const body = await req.json();
  const to = (body.to as string | undefined)?.trim();
  const subject = (body.subject as string | undefined)?.trim();
  const html = body.html as string | undefined;
  const campaignId = body.campaign_id as string | undefined;

  if (!to || !subject || !html) {
    return NextResponse.json({ error: "to, subject, and html are required" }, { status: 400 });
  }

  // Even though this route never operates on another tenant's resource, validate campaign_id
  // (when provided) via the existing assert_owns_campaign RPC before logging it — prevents a
  // landmine for any future feature that joins mail_sends -> campaigns via the admin client
  // without independently re-checking ownership. Design-review note.
  if (campaignId) {
    const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: campaignId });
    if (!owns) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }
  }

  const admin = createAdminClient();

  try {
    // Dispatches via the account's active sender — one of the connected
    // Resend/SendGrid/Mailgun/SMTP providers, or none configured.
    const result = await sendViaActiveSender(admin, user.id, ws as string, { to, subject, html });
    if (isSendFailure(result)) {
      if (result.reason === "not_connected") {
        return NextResponse.json({ error: "mail not connected" }, { status: 404 });
      }
      return NextResponse.json({ error: "mail connection needs to be reconnected" }, { status: 409 });
    }

    await admin.from("mail_sends").insert({
      user_id: user.id,
      campaign_id: campaignId ?? null,
      to_address: to,
      subject,
      message_id: result.messageId,
      provider: result.provider,
    });

    return NextResponse.json({ ok: true, message_id: result.messageId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to send" }, { status: 502 });
  }
}
