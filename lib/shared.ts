// Types and constants shared with client components — must stay free of Node/DB imports.

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

export type Campaign = {
  id: string;
  product_id: string;
  status: "building" | "ready" | "error";
  folder: string | null;
  drive_link: string | null;
  hoplinks_txt: string | null;
  fb_ads_md: string | null;
  tiktok_md: string | null;
  bridge_html: string | null;
  bridge_published: boolean;
  blog_md: string | null;
  social_md: string | null;
  email_md: string | null;
  images_json: { source_images: string[] } | null;
  embedded_image_data_url: string | null;
  page_copy: {
    headline: string;
    lead: string;
    mechanism: string;
    benefits: string[];
    proof: string;
    faq: { q: string; a: string }[];
    cta: string;
  } | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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

export type AuditPlatform = "facebook" | "instagram" | "tiktok" | "youtube" | "mail";

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
  created_at: string;
};

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
