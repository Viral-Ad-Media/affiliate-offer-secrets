import { marked } from "marked";
import { db } from "./core";
import { sendGmailMessage } from "@/lib/google/client";
import { getValidMailAccessToken } from "@/lib/google/mailToken";
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
// and this job actually running, not the primary gate (the sweep is).
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
  const tokenResult = await getValidMailAccessToken(db, userId);
  if (!tokenResult.ok) {
    throw new Error(
      tokenResult.reason === "not_connected" ? "Gmail is not connected" : "Gmail connection needs to be reconnected"
    );
  }

  const html =
    (marked.parse(stageData.body_md as string) as string) +
    renderUnsubscribeFooterHtml(stageData.unsub_token as string);

  const sent = await sendGmailMessage(tokenResult.accessToken, {
    to: stageData.to as string,
    subject: stageData.subject as string,
    html,
  });

  await db.from("broadcast_sends").insert({
    user_id: userId,
    sequence_id: stageData.sequence_id,
    step_id: stageData.step_id,
    enrollment_step_id: stageData.enrollment_step_id,
    contact_id: stageData.contact_id,
    campaign_id: stageData.campaign_id ?? null,
    to_address: stageData.to,
    subject: stageData.subject,
    message_id: sent.id,
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
