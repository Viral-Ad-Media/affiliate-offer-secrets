import type { FunnelStepType } from "@/lib/shared";

/**
 * The funnel shapes a tenant can build, and — honestly — which ones this app can actually deliver
 * today.
 *
 * `support` is not decoration. Four of these need capability that does not exist yet, and shipping
 * them as labels on a squeeze page would be a promise the product can't keep:
 *
 *   video      — VSL and Webinar are a video presentation. lib/engine/blockTree.ts has no `video`
 *                block (heading, subheading, paragraph, image, bullet_list, icon_list, divider,
 *                image_list, button, faq_item, form_input — that's the whole list), so there is
 *                nowhere to put the thing the funnel is named after.
 *   branching  — a Survey routes people to different pages based on their answer. funnel_steps is
 *                a linear chain ordered by step_index with no conditional edge.
 *   payment    — Book / free-plus-shipping needs an order form that charges the VISITOR. The Stripe
 *                integration in this codebase bills the tenant for their own access and credits;
 *                collecting a tenant's customers' money is a different system with its own
 *                compliance surface.
 *
 * Unsupported types stay VISIBLE in the picker with the reason attached rather than hidden —
 * someone who came looking for a webinar funnel should learn why it isn't there, not conclude the
 * feature is missing.
 */
export type FunnelSupport = "ready" | "needs_video" | "needs_branching" | "needs_payment";

export type FunnelTypeDef = {
  key: string;
  label: string;
  group: string;
  blurb: string;
  support: FunnelSupport;
  /** Steps created after the opt-in page. The opt-in page itself is always the entry point. */
  steps: FunnelStepType[];
};

export const FUNNEL_TYPES: FunnelTypeDef[] = [
  {
    key: "squeeze",
    label: "Squeeze page",
    group: "Lead generation",
    blurb: "One short page trading a free resource for an email address.",
    support: "ready",
    steps: ["thank_you"],
  },
  {
    key: "bridge",
    label: "Bridge funnel",
    group: "Lead generation",
    blurb: "Advertorial that warms a visitor up, then hands off to the vendor's offer.",
    support: "ready",
    steps: ["thank_you"],
  },
  {
    key: "summit",
    label: "Summit / hero",
    group: "Lead generation",
    blurb: "Registration page for an event or a link-in-bio capture.",
    support: "ready",
    steps: ["thank_you"],
  },
  {
    key: "application",
    label: "Application",
    group: "High ticket",
    blurb: "Qualifying questions before a prospect can book a call.",
    // Deliberately "ready": the qualifying form is real (form_input blocks with select/radio), and
    // the booking step is an ordinary page with a button to whatever scheduler they already use.
    // What's missing is native booking, not the funnel.
    support: "ready",
    steps: ["thank_you"],
  },
  {
    key: "vsl",
    label: "Video sales letter",
    group: "Presentation",
    blurb: "A video does the selling instead of long copy.",
    support: "ready",
    steps: ["thank_you", "order"],
  },
  {
    key: "webinar",
    label: "Webinar",
    group: "Presentation",
    blurb: "Registration, then a 45-90 minute workshop that pitches at the end.",
    support: "ready",
    steps: ["thank_you", "order"],
  },
  {
    key: "survey",
    label: "Survey",
    group: "Lead generation",
    blurb: "A bucket question sorts visitors, then routes each answer somewhere different.",
    support: "needs_branching",
    steps: ["thank_you"],
  },
  {
    key: "book",
    label: "Book / free-plus-shipping",
    group: "Low-ticket buyer",
    blurb: "Free item, visitor pays shipping, then instant order bumps.",
    support: "needs_payment",
    steps: ["order", "upsell", "thank_you"],
  },
];

export const SUPPORT_REASON: Record<Exclude<FunnelSupport, "ready">, string> = {
  needs_video: "Needs a video block — not in the page builder yet",
  needs_branching: "Needs answer-based routing — funnel steps run in a fixed order today",
  needs_payment: "Needs checkout for your buyers — billing here only covers your own account",
};

export function funnelType(key: string): FunnelTypeDef | null {
  return FUNNEL_TYPES.find((t) => t.key === key) ?? null;
}

export function isBuildable(key: string): boolean {
  return funnelType(key)?.support === "ready";
}

/** Start point for the funnel's pages. */
export type FunnelStart = "template" | "scratch";

export function isFunnelStart(v: unknown): v is FunnelStart {
  return v === "template" || v === "scratch";
}
