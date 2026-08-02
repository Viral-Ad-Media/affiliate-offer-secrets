// Types and constants shared with client components — must stay free of Node/DB imports.

import type { PageBlockTree } from "@/lib/engine/renderPages";

export type Product = {
  id: string;
  user_id: string;
  network: "clickbank" | "digistore24";
  vendor_id: string;
  niche: string;
  product_title: string;
  description: string | null;
  gravity: number | null;
  initial_sale: number | null;
  avg_sale: number | null;
  recurring: number | null;
  commission_pct: number | null;
  sales_page_url: string | null;
  affiliate_page_url: string | null;
  hoplink: string | null;
  score: number | null;
  angle_notes: string | null;
  page_verified: boolean;
  status: ProductStatus;
  assets_link: string | null;
  date_added: string | null;
  created_at: string;
  updated_at: string;
  campaign_id?: string | null;
  campaign_status?: string | null;
};

export type FbAdAngle = {
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
};

export type SocialPost = {
  caption: string;
};

export type Campaign = {
  id: string;
  product_id: string;
  status: "building" | "ready" | "error";
  folder: string | null;
  drive_link: string | null;
  hoplinks_txt: string | null;
  fb_ads_md: string | null;
  fb_ad_angles: FbAdAngle[] | null;
  tiktok_md: string | null;
  bridge_html: string | null;
  bridge_published: boolean;
  blog_md: string | null;
  social_md: string | null;
  social_posts: SocialPost[] | null;
  email_md: string | null;
  images_json: { source_images: string[] } | null;
  embedded_image_data_url: string | null;
  // Opaque from this file's perspective — could be the legacy flat shape (pre-Phase-O rows) or a
  // version-2 PageBlockTree, depending on when the row was last saved. Was previously a
  // hand-duplicated inline type here (and had already drifted from PageCopy — missing
  // sectionOrder); now imports the real type instead of re-declaring a shape that can go stale.
  page_copy: PageBlockTree | Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BridgeVariant = {
  id: string;
  campaign_id: string;
  label: string;
  is_control: boolean;
  weight: number;
  status: "active" | "paused";
  bridge_html: string | null;
  page_copy: Campaign["page_copy"];
  embedded_image_data_url: string | null;
  views: number;
  created_at: string;
  updated_at: string;
};

export type FunnelStepType = "thank_you" | "upsell" | "order";
export type FunnelStepCtaAction = "next_step" | "hoplink" | "redirect_url";

export type FunnelStep = {
  id: string;
  campaign_id: string;
  step_type: FunnelStepType;
  step_index: number;
  page_copy: Campaign["page_copy"];
  html: string | null;
  embedded_image_data_url: string | null;
  cta_action: FunnelStepCtaAction;
  redirect_url: string | null;
  target_product_id: string | null;
  decline_action: FunnelStepCtaAction;
  decline_redirect_url: string | null;
  created_at: string;
  updated_at: string;
};

export type CreativeSource = "fb_ad_angle" | "social_post";
export type CreativeKind = "image" | "video";
export type CreativeStatus = "none" | "generating" | "ready" | "failed";

export type CampaignCreative = {
  id: string;
  campaign_id: string;
  source: CreativeSource;
  item_index: number;
  kind: CreativeKind;
  status: CreativeStatus;
  image_data_url: string | null;
  video_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type AdLaunch = {
  id: string;
  campaign_id: string;
  angle_index: number;
  creative_kind: "image" | "video";
  status: "building" | "paused_review" | "activating" | "active" | "failed";
  budget_credits: number;
  notes: string | null;
};

export type Job = {
  id: string;
  type: "discover_products" | "build_campaign";
  payload: {
    niche?: string;
    vendor_id?: string;
    product_id?: string;
    network?: "clickbank" | "digistore24";
    [k: string]: unknown;
  };
  status: "pending" | "running" | "done" | "error";
  result: string | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  nickname: string | null;
  access_granted: boolean;
  trial_ends_at: string | null;
};

export type UsageEntry = {
  id: string;
  job_id: string | null;
  job_type: string;
  stage: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  created_at: string;
};

export type AuditPlatform = "facebook" | "instagram" | "tiktok" | "youtube" | "mail" | "broadcast";

export type AuditEntry = {
  id: string;
  platform: AuditPlatform;
  created_at: string;
  campaign_id: string | null;
  campaign_title: string | null;
  summary: string;
  detail: string | null;
  externalUrl: string | null;
};

export type Contact = {
  id: string;
  campaign_id: string | null;
  campaign_title: string | null;
  first_name: string | null;
  email: string;
  // Values from any user-added form_input blocks (Phase O.5) in the lead-capture form at
  // submission time, keyed by the block's stable fieldKey. Empty object for every lead captured
  // before this shipped, and for any form that never had extra fields to begin with.
  extra_fields: Record<string, string>;
  created_at: string;
};

export type BroadcastAudienceType = "campaign" | "all" | "manual";
export type BroadcastSequenceStatus = "draft" | "active" | "paused";

export type BroadcastSequence = {
  id: string;
  name: string;
  audience_type: BroadcastAudienceType;
  campaign_id: string | null;
  status: BroadcastSequenceStatus;
  created_at: string;
  updated_at: string;
};

export type BroadcastStep = {
  id: string;
  sequence_id: string;
  step_index: number;
  delay_days: number;
  subject: string;
  body_md: string;
};

export type BroadcastEnrollmentStepStatus = "pending" | "queued" | "sent" | "failed" | "skipped";

export function hasAppAccess(profile: Pick<Profile, "access_granted" | "trial_ends_at"> | null | undefined) {
  if (!profile) return false;
  if (profile.access_granted) return true;
  return !!profile.trial_ends_at && new Date(profile.trial_ends_at) > new Date();
}

export const PRODUCT_STATUSES = ["New", "Selected", "Promoting", "Paused", "Dead"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STATUS_COLORS: Record<string, string> = {
  New: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Selected: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Promoting: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Paused: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  Dead: "bg-red-500/15 text-red-300 border-red-500/30",
};

// ---------------------------------------------------------------------------------------------
// Superadmin. These mirror the return shapes of the admin_* RPCs in 0056_admin_reads.sql — those
// functions gate themselves with assert_superadmin(), so an ordinary tenant selecting these types
// in code still gets nothing back from the database.
// ---------------------------------------------------------------------------------------------

export type AdminAccountRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  access_granted: boolean;
  trial_ends_at: string | null;
  is_superadmin: boolean;
  credits: number;
  products: number;
  campaigns: number;
  contacts: number;
  jobs_error: number;
  spend_usd: number;
};

export type AdminProblemJob = {
  id: string;
  user_id: string;
  email: string;
  type: string;
  status: string;
  stage: number | null;
  attempts: number;
  result: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminActionRow = {
  id: string;
  actor_email: string | null;
  action: string;
  target_email: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};
