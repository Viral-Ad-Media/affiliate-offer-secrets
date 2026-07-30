import { marked } from "marked";
import { db } from "./core";
import { sendViaActiveSender, isSendFailure } from "@/lib/mail/send";
import { renderUnsubscribeFooterHtml } from "./broadcastEmail";

export const SEND_BROADCAST_EMAIL_STAGES = ["verify", "send"] as const;
export type SendBroadcastEmailStage = (typeof SEND_BROADCAST_EMAIL_STAGES)[number];

export type SendBroadcastEmailPayload = { enrollment_step_id: string };

export type BroadcastEmailStageOutput = {
  stageData: Record<string, unknown>;
  enrollmentStepPatch?: Record<string, unknown>;
  retry?: boolean;
  skip?: boolean;
};

// Pooled with mail_sends — matches run_broadcast_sweep()'s own admission-control cap exactly.
// This is a defensive re-check for the narrow race window between the sweep's admission check
// and this job actually running, not the primary gate (the sweep is). Provider-aware since
// 0027_provider_aware_send_cap.sql: applies only to personal-mailbox senders (Gmail OAuth, or
// SMTP pointed at a Gmail/Yahoo host, via the shared is_capped_mail_sender() SQL function) —
// transactional providers (Resend/SendGrid/Mailgun) are governed by their own plan limits.
const MAX_SENDS_PER_DAY = 300;

// The real security boundary — jobs' RLS only validates the row's own user_id, not
// payload.enrollment_step_id's contents. Re-scopes every hop (enrollment_step -> enrollment ->
// sequence/step -> contact) to job.user_id, mirroring every other job type's stage-0 pattern.
async function stageVerify(payload: SendBroadcastEmailPayload, userId: string): Promise<BroadcastEmailStageOutput> {
  const { data: enrollmentStep } = await db
    .from("broadcast_enrollment_steps")
    .select("id, enrollment_id, step_id")
    .eq("id", payload.enrollment_step_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!enrollmentStep) throw new Error("Broadcast enrollment step not found for this account");

  const { data: enrollment } = await db
    .from("broadcast_enrollments")
    .select("id, sequence_id, contact_id")
    .eq("id", enrollmentStep.enrollment_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!enrollment) throw new Error("Broadcast enrollment not found for this account");

  const { data: step } = await db
    .from("broadcast_steps")
    .select("subject, body_md")
    .eq("id", enrollmentStep.step_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!step) throw new Error("Broadcast step not found for this account");

  const { data: sequence } = await db
    .from("broadcast_sequences")
    .select("id, campaign_id")
    .eq("id", enrollment.sequence_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!sequence) throw new Error("Broadcast sequence not found for this account");

  const { data: contact } = await db
    .from("contacts")
    .select("email, unsubscribed_at, unsub_token")
    .eq("id", enrollment.contact_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!contact) throw new Error("Contact not found for this account");

  // Re-checked unconditionally right before every send — the actual security/compliance
  // boundary. The unsubscribe route eagerly flips enrollment/step status too, but that's a UI
  // nicety, not what's relied on here.
  if (contact.unsubscribed_at) {
    return { stageData: {}, skip: true, enrollmentStepPatch: { status: "skipped" } };
  }

  const { data: capped } = await db.rpc("is_capped_mail_sender", { p_user_id: userId });
  if (capped !== false) {
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ count: mailCount }, { count: broadcastCount }] = await Promise.all([
      db.from("mail_sends").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", cutoffIso),
      db
        .from("broadcast_sends")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "sent")
        .gte("created_at", cutoffIso),
    ]);
    if ((mailCount ?? 0) + (broadcastCount ?? 0) >= MAX_SENDS_PER_DAY) {
      return { stageData: {}, retry: true };
    }
  }

  return {
    stageData: {
      to: contact.email,
      unsub_token: contact.unsub_token,
      subject: step.subject,
      body_md: step.body_md,
      sequence_id: sequence.id,
      campaign_id: sequence.campaign_id,
      contact_id: enrollment.contact_id,
      step_id: enrollmentStep.step_id,
    },
  };
}

async function stageSend(stageData: Record<string, unknown>, userId: string): Promise<BroadcastEmailStageOutput> {
  const html =
    (marked.parse(stageData.body_md as string) as string) +
    renderUnsubscribeFooterHtml(stageData.unsub_token as string);

  // Dispatches via the account's active sender — Gmail (the default) or a connected
  // Resend/SendGrid/Mailgun/SMTP provider (lib/mail/send.ts). A not-connected/needs-reconnect
  // sender throws (normal retry-then-terminal-fail path), same as the Gmail-only era.
  const result = await sendViaActiveSender(db, userId, {
    to: stageData.to as string,
    subject: stageData.subject as string,
    html,
  });
  if (isSendFailure(result)) {
    throw new Error(
      result.reason === "not_connected"
        ? "Email sender is not connected"
        : "Email sender needs to be reconnected"
    );
  }

  await db.from("broadcast_sends").insert({
    user_id: userId,
    sequence_id: stageData.sequence_id,
    step_id: stageData.step_id,
    enrollment_step_id: stageData.enrollment_step_id,
    contact_id: stageData.contact_id,
    campaign_id: stageData.campaign_id ?? null,
    to_address: stageData.to,
    subject: stageData.subject,
    message_id: result.messageId,
    provider: result.provider,
    status: "sent",
  });

  return { stageData, enrollmentStepPatch: { status: "sent" } };
}

export async function runSendBroadcastEmailStage(
  stageIndex: number,
  payload: SendBroadcastEmailPayload,
  userId: string,
  stageData: Record<string, unknown>
): Promise<BroadcastEmailStageOutput> {
  const stage = SEND_BROADCAST_EMAIL_STAGES[stageIndex];
  switch (stage) {
    case "verify":
      return stageVerify(payload, userId);
    case "send":
      return stageSend({ ...stageData, enrollment_step_id: payload.enrollment_step_id }, userId);
    default:
      throw new Error(`Unknown send_broadcast_email stage index ${stageIndex}`);
  }
}
