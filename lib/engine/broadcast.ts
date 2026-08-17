import { marked } from "marked";
import { db } from "./core";
import { sendViaActiveSender, isSendFailure } from "@/lib/mail/send";
import { sendSmsToContact } from "@/lib/sms/send";
import { composeSms } from "@/lib/sms";
import { checkSendWindow } from "@/lib/sms/window";
import { renderUnsubscribeFooterHtml } from "./broadcastEmail";
import { EMAIL_SETTINGS_COLUMNS } from "@/lib/emailSettings";

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
// 0027_provider_aware_send_cap.sql: applies only to personal-mailbox senders (SMTP pointed at a
// Gmail/Yahoo/consumer host, via the shared is_capped_mail_workspace() SQL function) —
// transactional providers (Resend/SendGrid/Mailgun) are governed by their own plan limits.
const MAX_SENDS_PER_DAY = 300;

type BroadcastSendContext = {
  enrollmentStep: { id: string; enrollment_id: string; step_id: string };
  enrollment: { id: string; sequence_id: string; contact_id: string; status: string };
  // step_index drives which message carries the code-owned STOP line (sms only).
  step: { subject: string; body_md: string; step_index: number };
  sequence: { id: string; campaign_id: string | null; status: string; channel: string };
  contact: { email: string; unsubscribed_at: string | null; unsub_token: string };
};

async function loadBroadcastSendContext(
  enrollmentStepId: string,
  workspaceId: string
): Promise<BroadcastSendContext | null> {
  const { data: enrollmentStep, error: enrollmentStepError } = await db
    .from("broadcast_enrollment_steps")
    .select("id, enrollment_id, step_id")
    .eq("id", enrollmentStepId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (enrollmentStepError) throw new Error(`Could not load broadcast schedule: ${enrollmentStepError.message}`);
  if (!enrollmentStep) return null;

  const { data: enrollment, error: enrollmentError } = await db
    .from("broadcast_enrollments")
    .select("id, sequence_id, contact_id, status")
    .eq("id", enrollmentStep.enrollment_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (enrollmentError) throw new Error(`Could not load broadcast enrollment: ${enrollmentError.message}`);
  if (!enrollment) return null;

  const [stepResult, sequenceResult, contactResult] = await Promise.all([
    db
      .from("broadcast_steps")
      .select("subject, body_md, step_index")
      .eq("id", enrollmentStep.step_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("broadcast_sequences")
      .select("id, campaign_id, status, channel")
      .eq("id", enrollment.sequence_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("contacts")
      .select("email, unsubscribed_at, unsub_token")
      .eq("id", enrollment.contact_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);
  if (stepResult.error) throw new Error(`Could not load broadcast step: ${stepResult.error.message}`);
  if (sequenceResult.error) {
    throw new Error(`Could not load broadcast sequence: ${sequenceResult.error.message}`);
  }
  if (contactResult.error) throw new Error(`Could not load broadcast contact: ${contactResult.error.message}`);
  const step = stepResult.data;
  const sequence = sequenceResult.data;
  const contact = contactResult.data;
  if (!step || !sequence || !contact) return null;

  return { enrollmentStep, enrollment, step, sequence, contact } as BroadcastSendContext;
}

async function workspaceSendCapReached(workspaceId: string): Promise<boolean> {
  const { data: capped, error: capError } = await db.rpc("is_capped_mail_workspace", {
    p_workspace_id: workspaceId,
  });
  if (capError) throw new Error(`Could not verify broadcast send cap: ${capError.message}`);
  if (capped === false) return false;

  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [mailResult, broadcastResult] = await Promise.all([
    db
      .from("mail_sends")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", cutoffIso),
    db
      .from("broadcast_sends")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .gte("created_at", cutoffIso),
  ]);
  if (mailResult.error) throw new Error(`Could not count direct sends: ${mailResult.error.message}`);
  if (broadcastResult.error) {
    throw new Error(`Could not count broadcast sends: ${broadcastResult.error.message}`);
  }
  const mailCount = mailResult.count;
  const broadcastCount = broadcastResult.count;
  return (mailCount ?? 0) + (broadcastCount ?? 0) >= MAX_SENDS_PER_DAY;
}

// The real security boundary — a job payload is not trusted. Re-scope every hop
// (enrollment_step -> enrollment -> sequence/step -> contact) to the job's workspace.
async function stageVerify(payload: SendBroadcastEmailPayload, workspaceId: string): Promise<BroadcastEmailStageOutput> {
  const context = await loadBroadcastSendContext(payload.enrollment_step_id, workspaceId);
  if (!context) return { stageData: {}, skip: true };

  // Re-checked unconditionally right before every send — the actual security/compliance
  // boundary. The unsubscribe route eagerly flips enrollment/step status too, but that's a UI
  // nicety, not what's relied on here.
  if (context.enrollment.status !== "active" || context.contact.unsubscribed_at) {
    return { stageData: {}, skip: true, enrollmentStepPatch: { status: "skipped" } };
  }
  if (context.sequence.status === "paused") return { stageData: {}, retry: true };
  if (context.sequence.status !== "active") return { stageData: {}, skip: true };

  if (await workspaceSendCapReached(workspaceId)) return { stageData: {}, retry: true };

  // Do not persist recipient PII in jobs.stage_data. The send stage reloads the contact and
  // consent state after this stage commits, so an erasure/unsubscribe/pause wins before delivery.
  return { stageData: {} };
}

async function stageSend(stageData: Record<string, unknown>, userId: string, workspaceId: string): Promise<BroadcastEmailStageOutput> {
  // Sender identity for the footer (business name + postal address). Read per send rather than
  // baked into the step at enrollment time: an address correction should apply to mail going out
  // now, not only to sequences enrolled after the edit.
  const { data: emailSettings, error: emailSettingsError } = await db
    .from("email_settings")
    .select(EMAIL_SETTINGS_COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (emailSettingsError) {
    throw new Error(`Could not load email compliance settings: ${emailSettingsError.message}`);
  }

  const enrollmentStepId = stageData.enrollment_step_id as string;
  const context = await loadBroadcastSendContext(enrollmentStepId, workspaceId);
  if (!context) return { stageData: {}, skip: true };
  const isSms = context.sequence.channel === "sms";

  // Lifecycle checks are shared; the CONSENT check is not. An email unsubscribe must not stop an
  // SMS step (0097: the two consents are legally distinct), and SMS eligibility is re-checked
  // inside sendSmsToContact against the columns that actually govern it.
  if (context.enrollment.status !== "active" || (!isSms && context.contact.unsubscribed_at)) {
    return { stageData: {}, skip: true, enrollmentStepPatch: { status: "skipped" } };
  }
  if (context.sequence.status === "paused") return { stageData: {}, retry: true };
  if (context.sequence.status !== "active") return { stageData: {}, skip: true };
  // The pooled daily cap exists to protect a personal MAILBOX from being flagged; it counts
  // mail_sends + broadcast_sends and is keyed on the mail sender's host. It has nothing to say
  // about SMS, which is governed by the provider's own per-number throughput.
  if (!isSms && (await workspaceSendCapReached(workspaceId))) return { stageData: {}, retry: true };

  if (isSms) {
    // Clock-based gates BEFORE the contact-based ones, and they RETRY rather than skip: quiet
    // hours and throughput are both temporary, so the step waits for a later sweep tick instead
    // of being marked skipped forever. heartbeatRetry keeps the attempts cap from eating the job
    // while it waits — the same mechanic a not-ready video poll uses.
    const window = await checkSendWindow(db, workspaceId);
    if (!window.ok) {
      if (window.reason === "no_connection") throw new Error("No SMS provider connected");
      return { stageData: {}, retry: true };
    }

    // The step's body IS the message; `subject` is an internal label for sms steps and is never
    // sent. composeSms adds the code-owned STOP line to the first message of the sequence, which
    // is why step_index matters here — the same function the kit preview renders through, so what
    // was previewed is what sends.
    const result = await sendSmsToContact(db, {
      workspaceId,
      userId,
      contactId: context.enrollment.contact_id as string,
      body: composeSms(context.step.body_md, context.step.step_index - 1),
      campaignId: context.sequence.campaign_id,
    });

    if (!result.ok) {
      // A consent problem is TERMINAL for this step, not a retry: no amount of trying again turns
      // "they opted out" or "no number on file" into a send, and retrying would burn the attempts
      // cap to reach the same answer. Only a provider/transport failure is worth another go.
      if (result.reason === "failed") throw new Error(result.message);
      return { stageData: {}, skip: true, enrollmentStepPatch: { status: "skipped" } };
    }
    return { stageData: {}, enrollmentStepPatch: { status: "sent", sent_at: new Date().toISOString() } };
  }

  // One final contact read immediately before dispatch. This closes the persisted-stage gap and
  // reduces an unavoidable already-in-flight unsubscribe race to the provider-call boundary.
  const { data: liveContact, error: liveContactError } = await db
    .from("contacts")
    .select("email, unsubscribed_at, unsub_token")
    .eq("id", context.enrollment.contact_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (liveContactError) throw new Error(`Could not recheck broadcast consent: ${liveContactError.message}`);
  if (!liveContact || liveContact.unsubscribed_at) {
    return { stageData: {}, skip: true, enrollmentStepPatch: { status: "skipped" } };
  }

  const html =
    (marked.parse(context.step.body_md) as string) +
    renderUnsubscribeFooterHtml(liveContact.unsub_token, emailSettings);

  // Dispatches via the account's active sender — a connected
  // Resend/SendGrid/Mailgun/SMTP provider (lib/mail/send.ts). A not-connected/needs-reconnect
  // sender throws (normal retry-then-terminal-fail path).
  const result = await sendViaActiveSender(db, userId, workspaceId, {
    to: liveContact.email,
    subject: context.step.subject,
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
    workspace_id: workspaceId,
    sequence_id: context.sequence.id,
    step_id: context.enrollmentStep.step_id,
    enrollment_step_id: context.enrollmentStep.id,
    contact_id: context.enrollment.contact_id,
    campaign_id: context.sequence.campaign_id,
    to_address: liveContact.email,
    subject: context.step.subject,
    message_id: result.messageId,
    provider: result.provider,
    status: "sent",
  });

  return { stageData: {}, enrollmentStepPatch: { status: "sent" } };
}

export async function runSendBroadcastEmailStage(
  stageIndex: number,
  payload: SendBroadcastEmailPayload,
  userId: string,
  workspaceId: string,
  stageData: Record<string, unknown>
): Promise<BroadcastEmailStageOutput> {
  const stage = SEND_BROADCAST_EMAIL_STAGES[stageIndex];
  switch (stage) {
    case "verify":
      return stageVerify(payload, workspaceId);
    case "send":
      return stageSend({ ...stageData, enrollment_step_id: payload.enrollment_step_id }, userId, workspaceId);
    default:
      throw new Error(`Unknown send_broadcast_email stage index ${stageIndex}`);
  }
}
