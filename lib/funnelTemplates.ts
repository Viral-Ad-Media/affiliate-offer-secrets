import {
  normalizePageCopy,
  type PageBlockTree,
  type PageCopy,
  type FunnelStepType,
  type SectionBlock,
  type LockedBlock,
  type FormInputBlock,
} from "@/lib/engine/renderPages";
import { funnelType } from "@/lib/funnelTypes";

/**
 * Starter page content for a newly created funnel.
 *
 * Templates are written in the LEGACY flat PageCopy shape on purpose, then run through
 * normalizePageCopy() — the same permanent adapter every AI-generated campaign goes through. That
 * means a template can never produce a tree shape the renderer hasn't already been serving in
 * production, and the locked compliance blocks (disclosure, lead-capture form, primary CTA) come
 * from one place rather than being hand-assembled per template and drifting.
 *
 * The copy is deliberately generic and product-agnostic — `{PRODUCT}` is substituted with the real
 * product title, and everything else is a prompt to the person editing rather than a claim. A
 * template that asserted a benefit or a result would be putting words in the affiliate's mouth on
 * a page that carries their disclosure, and this app's compliance rules don't allow invented
 * proof. Real, product-specific copy is what "Promote" (the AI build) is for; this is scaffolding.
 */

type Template = Omit<PageCopy, "headline"> & { headline: string };

const TEMPLATES: Record<string, Template> = {
  squeeze: {
    headline: "Get the free {PRODUCT} guide",
    lead: "Tell readers in one sentence what they get and why it's worth their email address.",
    mechanism: "Describe what's inside — the one thing this guide explains that they can't easily find elsewhere.",
    benefits: [
      "What they'll learn first",
      "What they'll be able to do afterwards",
      "How long it takes to read or use",
    ],
    proof: "If you have a real result, a testimonial or a credential, put it here. Leave it out if you don't.",
    faq: [
      { q: "Is this really free?", a: "Yes — say what happens after they enter their email." },
      { q: "Who is this for?", a: "Name the person this actually helps, and who it doesn't." },
    ],
    cta: "Send me the free guide",
  },
  bridge: {
    headline: "Before you look at {PRODUCT}, read this",
    lead: "Open with the problem your reader already knows they have. Don't mention the product yet.",
    mechanism: "Explain why the usual approach doesn't work, then what makes this one different.",
    benefits: ["The change they're actually after", "What it takes to get there", "What it doesn't require"],
    proof: "Your own experience with it, honestly stated. What you can't verify, don't claim.",
    faq: [
      { q: "How much does it cost?", a: "Answer plainly — surprises on the next page cost you the sale." },
      { q: "What if it isn't for me?", a: "State the refund or guarantee terms exactly as the vendor states them." },
    ],
    cta: "Show me how it works",
  },
  summit: {
    headline: "Save your seat: {PRODUCT}",
    lead: "Say what the event is, when it runs, and what someone walks away with.",
    mechanism: "Outline the sessions or the running order, so registering feels like a known quantity.",
    benefits: ["Session one — what it covers", "Session two — what it covers", "What attendees get to keep"],
    proof: "Who's speaking and why they're worth an hour of someone's time.",
    faq: [
      { q: "Is it recorded?", a: "Say yes or no, and how long any replay stays up." },
      { q: "What does it cost?", a: "State the price, or say plainly that it's free." },
    ],
    cta: "Save my seat",
  },
  application: {
    headline: "Apply to work through {PRODUCT}",
    lead: "Say who this is for and be specific about who it isn't for — that's what makes an application work.",
    mechanism: "Explain what happens after they apply: who reviews it, how long it takes, what the next step is.",
    benefits: ["What's included", "What's expected of them", "How long the process runs"],
    proof: "Track record, if you have one you can back up.",
    faq: [
      { q: "What happens after I apply?", a: "Describe the real next step — a call, an email, a decision window." },
      { q: "Is everyone accepted?", a: "If not, say what you're screening for." },
    ],
    cta: "Start my application",
  },
};

/** Copy for a step page. Keyed by step type, not by funnel type — a thank-you page is a thank-you
 *  page regardless of which funnel it sits in, and pretending otherwise would be four near-identical
 *  templates that all drift separately. */
const STEP_TEMPLATES: Record<FunnelStepType, Template> = {
  thank_you: {
    headline: "You're in — here's what happens next",
    lead: "Confirm what they just signed up for and tell them exactly where to look for it.",
    mechanism: "If the email takes a few minutes or might land in spam, say so here rather than losing them to it.",
    benefits: ["Check your inbox", "Add the sender to your contacts", "What to do first"],
    proof: "",
    faq: [],
    cta: "Continue",
  },
  upsell: {
    headline: "One thing that pairs with this",
    lead: "Say what this is and why it's relevant to what they just asked for. One offer, not a catalogue.",
    mechanism: "Explain what it adds. If it isn't a fit for everyone, say who it isn't for.",
    benefits: ["What it includes", "What it costs", "The guarantee or refund terms"],
    proof: "",
    faq: [],
    cta: "Yes, add this",
  },
  order: {
    headline: "Complete your order",
    lead: "Restate what they're getting, at what price, and what happens immediately after.",
    mechanism: "Payment is handled on the vendor's own checkout — this page hands off to it.",
    benefits: ["What's delivered", "How it's delivered", "The refund terms"],
    proof: "",
    faq: [],
    cta: "Go to checkout",
  },
};

function fill(t: Template, productTitle: string): PageCopy {
  const sub = (s: string) => s.replaceAll("{PRODUCT}", productTitle);
  return {
    headline: sub(t.headline),
    lead: sub(t.lead),
    mechanism: sub(t.mechanism),
    benefits: t.benefits.map(sub),
    proof: sub(t.proof),
    faq: t.faq.map((f) => ({ q: sub(f.q), a: sub(f.a) })),
    cta: sub(t.cta),
  };
}

/**
 * An empty page — built directly rather than via normalizePageCopy, because that adapter always
 * emits all five legacy sections (resolveSectionOrder appends any missing key by design), so
 * "empty" through it would mean five stray subheadings the user has to delete one by one.
 *
 * The locked blocks are still here and still mandatory: "start from scratch" means no marketing
 * copy, not no disclosure and no working opt-in form. Their shape is kept deliberately identical
 * to normalizePageCopy's own so the two paths can't drift into producing different locked blocks.
 */
function blankTree(stepType?: FunnelStepType): PageBlockTree {
  let n = 0;
  const id = () => `blank-${n++}`;

  const section: SectionBlock = {
    id: id(),
    type: "section",
    style: {},
    children: [
      { id: id(), type: "heading", style: {}, content: { text: "" } },
      { id: id(), type: "paragraph", style: {}, content: { text: "" } },
    ],
  };

  const blocks: (SectionBlock | LockedBlock)[] = [section];

  if (stepType === "upsell") {
    blocks.push({
      id: id(),
      type: "decline_link",
      locked: "decline_link",
      style: {},
      content: { text: "No thanks, continue" },
    });
  }

  if (stepType) {
    blocks.push({ id: id(), type: "primary_cta", locked: "primary_cta", style: {}, content: { text: "Continue" } });
  } else {
    blocks.push({
      id: id(),
      type: "lead_capture_form",
      locked: "lead_capture_form",
      style: {},
      content: { ctaText: "Continue" },
      children: [] as FormInputBlock[],
    });
    blocks.push({ id: id(), type: "primary_cta", locked: "primary_cta", style: {}, content: { text: "Continue" } });
  }

  blocks.push({ id: id(), type: "disclosure", locked: "disclosure", style: {}, content: {} });

  return { version: 2, blocks };
}

export type FunnelStart = "template" | "scratch";

/** The opt-in (bridge) page's starting content for a given funnel type. */
export function optInPageCopy(
  typeKey: string,
  start: FunnelStart,
  productTitle: string,
  imageDataUrl: string | null
): PageBlockTree {
  if (start === "scratch") return blankTree();
  const t = TEMPLATES[typeKey];
  // An unknown/unsupported type falls back to blank rather than to another type's copy — a squeeze
  // page's words on a funnel someone asked to be something else is worse than an empty page.
  if (!t) return blankTree();
  return normalizePageCopy(fill(t, productTitle), imageDataUrl);
}

/** A step page's starting content. */
export function stepPageCopy(
  stepType: FunnelStepType,
  start: FunnelStart,
  productTitle: string
): PageBlockTree {
  if (start === "scratch") return blankTree(stepType);
  return normalizePageCopy(fill(STEP_TEMPLATES[stepType], productTitle), null, { stepType });
}

/** The step types a funnel type creates after its opt-in page, or null if the type isn't real. */
export function stepsForType(typeKey: string): FunnelStepType[] | null {
  const def = funnelType(typeKey);
  return def ? def.steps : null;
}
