import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET, not POST/RPC — a deliberate, narrow exception to this codebase's usual write-via-POST/RPC
// rule: the link must work as a bare <a href> inside an email client with zero JS (universal ESP
// convention), and the only possible harm from a forged/prefetched GET is an unwanted unsubscribe
// of that same contact — the least-harmful direction this action could fail in.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  const admin = createAdminClient();

  // Same enumeration-oracle guard as app/api/public/leads/route.ts uses for campaign UUIDs —
  // generic response either way (found vs. not), no distinguishing message.
  const { data: contact } = token
    ? await admin.from("contacts").select("id, workspace_id").eq("unsub_token", token).maybeSingle()
    : { data: null };

  if (contact) {
    // Idempotent — a second click is a no-op. Eagerly flips enrollments/steps too, purely so the
    // UI's enrollment stats don't keep showing "active" for a contact who already opted out — NOT
    // the security boundary; lib/engine/broadcast.ts's verify stage re-checks unsubscribed_at
    // unconditionally right before every send regardless of these writes.
    await admin.from("contacts").update({ unsubscribed_at: new Date().toISOString() }).eq("id", contact.id);
    await admin.rpc("cancel_contact_broadcast_jobs", {
      p_workspace_id: contact.workspace_id,
      p_contact_ids: [contact.id],
    });
    await admin.from("broadcast_enrollments").update({ status: "unsubscribed" }).eq("contact_id", contact.id);
    const { data: enrollments } = await admin.from("broadcast_enrollments").select("id").eq("contact_id", contact.id);
    const enrollmentIds = (enrollments ?? []).map((e) => e.id);
    if (enrollmentIds.length > 0) {
      await admin
        .from("broadcast_enrollment_steps")
        .update({ status: "skipped" })
        .in("enrollment_id", enrollmentIds)
        .in("status", ["pending", "queued"]);
    }
  }

  // A real person lands here from their inbox — a minimal static confirmation page, not JSON.
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;text-align:center;color:#333;"><h1>You're unsubscribed</h1><p>You won't receive any more emails from this sender.</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
