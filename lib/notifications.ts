import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type NotificationKind =
  | "job_failed"
  | "campaign_ready"
  | "referral_rewarded"
  | "domain_error"
  | "mail_sender_error"
  // Billing. The DB CHECK on notifications.kind is an allowlist, so these had to be added there
  // too — and notify() never throws, so a missing kind fails silently and invisibly.
  | "trial_ending"
  | "billing_failed"
  | "billing_succeeded";

// Server-only notification writer. Every caller runs as service_role (worker, API routes) —
// `notifications` has no client insert policy, deliberately.
//
// Never throws: a notification is a nicety layered on top of whatever just happened, and the
// caller is usually mid-way through something that matters more (finishing a job, failing a job,
// serving a request). Letting an insert error propagate could turn "the campaign built fine but
// we couldn't tell you" into "the job failed", which is strictly worse. Errors are logged.
export async function notify(
  admin: AdminClient,
  userId: string,
  n: { kind: NotificationKind; title: string; body?: string | null; href?: string | null }
): Promise<void> {
  try {
    const { error } = await admin.from("notifications").insert({
      user_id: userId,
      kind: n.kind,
      title: n.title.slice(0, 200),
      body: n.body ? n.body.slice(0, 500) : null,
      href: n.href ?? null,
    });
    if (error) console.error("notify failed:", error.message);
  } catch (err) {
    console.error("notify threw:", err);
  }
}

// Job-type → human phrasing. Kept here rather than in the UI so the stored title reads correctly
// wherever it surfaces, and so a new job type shows something sane instead of a raw enum.
const JOB_LABELS: Record<string, string> = {
  discover_products: "Product discovery",
  build_campaign: "Campaign kit build",
  launch_ad: "Ad launch",
  generate_ad_image: "Ad image generation",
  generate_video: "Video generation",
  generate_blog_image: "Blog image generation",
  generate_creative_image: "Creative image generation",
  generate_creative_video: "Creative video generation",
  send_broadcast_email: "Broadcast email",
};

export function jobLabel(type: string): string {
  return JOB_LABELS[type] ?? type;
}
