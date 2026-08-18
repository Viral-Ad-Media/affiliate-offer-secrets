import type { FunnelStepType } from "@/lib/shared";
import { isFunnelStyleId, type FunnelStyleId } from "@/lib/funnelStyles";

/**
 * The funnel shapes a tenant can build, and — honestly — which ones this app can actually deliver
 * today.
 *
 * `support` is not decoration: a type shipped as a label on a squeeze page would be a promise the
 * product can't keep. What is still unmet:
 *
 *   payment    — Book / free-plus-shipping needs an order form that charges the VISITOR. The Stripe
 *                integration in this codebase bills the tenant for their own access and credits;
 *                collecting a tenant's customers' money is a different system with its own
 *                compliance surface.
 *
 * Two capabilities that used to be unmet now exist, and the reasons are worth keeping because they
 * are what the `support` field is FOR:
 *
 *   video      — VSL and Webinar were blocked on there being no `video` block. There is one now
 *                (lib/engine/videoEmbed.ts parses the source; the renderer rebuilds the embed URL
 *                from a fixed template rather than interpolating what was pasted).
 *   branching  — a Survey routes people to different pages based on their answer, and funnel_steps
 *                is still a linear chain with no conditional edge. The routing does NOT live there:
 *                it is a form's `branch` after-submit action (lib/engine/blockTree.ts), whose
 *                targets are resolved to real URLs at bake time. So the chain stayed linear and the
 *                branch sits on the page, which is also why it needed no migration.
 *
 * Unsupported types stay VISIBLE in the picker with the reason attached rather than hidden —
 * someone who came looking for a checkout funnel should learn why it isn't there, not conclude the
 * feature is missing.
 */
/** Display name for a funnel — the tenant's own label, never shown to visitors. */
export const MAX_FUNNEL_NAME = 80;

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
    support: "ready",
    steps: ["thank_you"],
  },
  {
    key: "advertorial",
    label: "Advertorial",
    group: "Paid traffic",
    blurb: "Story-style presell that sells the click — no opt-in form, the CTA goes straight to the offer.",
    // Ready because everything it needs already exists: a bridge tree with NO lead-capture form
    // gets the locked primary_cta appended (reconcileBridgeCta), which resolves to the offer at
    // render time. What it deliberately does NOT do is capture a lead — that is the trade the
    // format makes for a shorter path to the sale, and the blurb says so.
    support: "ready",
    steps: [],
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

/**
 * Display names for the step types. Lives here rather than inside FunnelMap (where it started)
 * because the step editor's checklist header needs the same words — two copies of a label map is
 * how a "Thank-you" page ends up called "Thank you" one screen over.
 */
export const STEP_TYPE_LABELS: Record<FunnelStepType, string> = {
  thank_you: "Thank-you",
  upsell: "Upsell",
  order: "Order",
};

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

/** Start point for the funnel's pages: one of the six styles, or an empty page. */
export type FunnelStart = FunnelStyleId | "scratch";

export function isFunnelStart(v: unknown): v is FunnelStart {
  return v === "scratch" || isFunnelStyleId(v);
}
