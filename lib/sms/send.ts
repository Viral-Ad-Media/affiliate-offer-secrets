// The one place an SMS is sent. SERVER-ONLY.
//
// Every send goes through sendSmsToContact() — the same discipline sendViaActiveSender() enforces
// for email — so "may we text this person" is decided once rather than at each call site. That
// matters more here than for email: the answer is a legal question, and a second code path that
// forgets to ask it is the difference between a marketing channel and a regulatory problem.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTwilioSms, TwilioError, TWILIO_OPTED_OUT, TWILIO_AUTH_ERROR } from "@/lib/twilio/client";
import { smsSegments } from "@/lib/sms";

export type SmsSendResult =
  | { ok: true; sid: string; segments: number }
  | { ok: false; reason: "no_connection" | "no_consent" | "opted_out" | "no_phone" | "failed"; message: string };

/**
 * Sends one message to one contact, refusing unless consent is on file.
 *
 * The gate is deliberately three separate checks rather than one boolean, because they are three
 * different facts with different remedies: we have no number, we have a number but were never
 * given permission, or we were given permission and it was withdrawn. Collapsing them would make
 * "why didn't this send" unanswerable.
 *
 * A refusal is RECORDED (status 'skipped') rather than silently dropped. A message that was never
 * sent because someone opted out is exactly the thing you want evidence of later.
 */
export async function sendSmsToContact(
  admin: SupabaseClient,
  args: { workspaceId: string; userId: string; contactId: string; body: string; campaignId?: string | null }
): Promise<SmsSendResult> {
  const { data: contact } = await admin
    .from("contacts")
    .select("id, phone, sms_consent_at, sms_opted_out_at")
    .eq("id", args.contactId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  const audit = async (status: "sent" | "failed" | "skipped", extra: Record<string, unknown>) => {
    await admin.from("sms_sends").insert({
      workspace_id: args.workspaceId,
      user_id: args.userId,
      contact_id: args.contactId,
      campaign_id: args.campaignId ?? null,
      to_number: contact?.phone ?? "unknown",
      body: args.body,
      segments: smsSegments(args.body).segments,
      status,
      ...extra,
    });
  };

  if (!contact?.phone) {
    await audit("skipped", { error_message: "No phone number on file" });
    return { ok: false, reason: "no_phone", message: "No phone number on file" };
  }
  if (contact.sms_opted_out_at) {
    await audit("skipped", { error_message: "Contact opted out of SMS" });
    return { ok: false, reason: "opted_out", message: "Contact opted out of SMS" };
  }
  if (!contact.sms_consent_at) {
    // The default answer. A phone number captured on an opt-in form is NOT consent to text it —
    // see the 0097 migration — so absence of consent refuses rather than assuming.
    await audit("skipped", { error_message: "No SMS consent on file" });
    return { ok: false, reason: "no_consent", message: "No SMS consent on file" };
  }

  const { data: conn } = await admin
    .from("sms_connections")
    .select("account_sid, auth_token_secret_id, from_number, status")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!conn) {
    await audit("failed", { error_message: "No SMS provider connected" });
    return { ok: false, reason: "no_connection", message: "No SMS provider connected" };
  }

  const { data: token } = await admin.rpc("get_oauth_secret", { p_secret_id: conn.auth_token_secret_id });
  if (!token) {
    await audit("failed", { error_message: "Stored credential could not be read" });
    return { ok: false, reason: "no_connection", message: "Stored credential could not be read" };
  }

  try {
    const sent = await sendTwilioSms({
      accountSid: conn.account_sid,
      authToken: String(token),
      from: conn.from_number,
      to: contact.phone,
      body: args.body,
    });
    await audit("sent", { provider_sid: sent.sid });
    return { ok: true, sid: sent.sid, segments: smsSegments(args.body).segments };
  } catch (err) {
    const e = err instanceof TwilioError ? err : null;

    // Twilio keeps its own STOP list. If it refuses on that basis, the contact opted out through a
    // path we never saw (a carrier-level STOP, or an opt-out predating this connection) — so
    // record it locally rather than rediscovering it on every future send.
    if (e?.code === TWILIO_OPTED_OUT) {
      await admin
        .from("contacts")
        .update({ sms_opted_out_at: new Date().toISOString() })
        .eq("id", args.contactId)
        .eq("workspace_id", args.workspaceId);
      await audit("skipped", { error_message: "Provider reports this number opted out" });
      return { ok: false, reason: "opted_out", message: "Provider reports this number opted out" };
    }

    // A rejected credential degrades the connection so the UI can say "reconnect", mirroring how
    // mail providers handle an auth-shaped failure. Anything else is left alone — a transient
    // provider error must not disable a working connection.
    if (e?.code === TWILIO_AUTH_ERROR) {
      await admin
        .from("sms_connections")
        .update({ status: "error", error_message: e.message })
        .eq("workspace_id", args.workspaceId);
    }

    const message = e?.message ?? (err as Error).message ?? "Send failed";
    await audit("failed", { error_message: message });
    return { ok: false, reason: "failed", message };
  }
}
