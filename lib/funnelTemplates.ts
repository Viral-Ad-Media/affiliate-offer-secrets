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
import { funnelStyle, VOICE_PROMPTS, type FunnelStyle, type FunnelStyleId } from "@/lib/funnelStyles";

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
  vsl: {
    headline: "Watch this before you decide on {PRODUCT}",
    lead: "One line telling them what the video covers and roughly how long it runs.",
    mechanism: "Say what they'll understand by the end that they don't now.",
    benefits: ["What the video shows", "Who it's for", "What to do after watching"],
    proof: "Why you're the one presenting this, if that's relevant.",
    faq: [
      { q: "How long is it?", a: "Give the real running time — a surprise 90 minutes loses people." },
      { q: "Do I need to watch it all?", a: "Say where the important part starts if it isn't the beginning." },
    ],
    cta: "Get access now",
  },
  webinar: {
    headline: "Free training: {PRODUCT}",
    lead: "What the session covers, when it runs, and how long it takes.",
    mechanism: "Outline what you'll walk through, so registering feels like a known quantity.",
    benefits: ["What you'll cover first", "What they'll be able to do afterwards", "Whether there's a replay"],
    proof: "Who's presenting and why they're worth the time.",
    faq: [
      { q: "Is it live or recorded?", a: "Say which, plainly — this is the question people actually ask." },
      { q: "Is there a pitch at the end?", a: "If there is, say so. They'll find out anyway." },
    ],
    cta: "Save my spot",
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

// Types where the video IS the page, so the template seeds a video block rather than an image.
const VIDEO_FIRST_TYPES = new Set(["vsl", "webinar"]);

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
 * Composes a type's subject matter with a style's shape.
 *
 * The TYPE decides what the page is about (a squeeze page's headline is about a free resource, a
 * webinar's about a session); the STYLE decides which sections exist, in what order, and how the
 * placeholder prompts are pitched. Written as a composition rather than 36 hand-authored
 * templates, which would drift apart the first time anyone edited one of them.
 *
 * `sectionOrder` is what actually drops the sections a style leaves out — resolveSectionOrder
 * appends every missing key by design, so the sections themselves are emptied here and the order
 * is set to just the ones this style keeps.
 */
function styled(base: PageCopy, style: FunnelStyle): PageCopy {
  const v = VOICE_PROMPTS[style.voice];
  const keep = new Set(style.sections);
  return {
    headline: base.headline,
    // The style's voice replaces the type's generic prompt wherever it has an opinion; where it
    // doesn't (spare/captioned leave mechanism and proof empty), the section is dropped anyway.
    lead: keep.has("lead") ? v.lead || base.lead : "",
    mechanism: keep.has("mechanism") ? v.mechanism || base.mechanism : "",
    proof: keep.has("proof") ? v.proof || base.proof : "",
    benefits: keep.has("benefits")
      ? Array.from({ length: style.bullets }, (_, i) => v.bullet(i) || base.benefits[i] || "").filter(Boolean)
      : [],
    faq: keep.has("faq")
      ? Array.from({ length: style.faqs }, (_, i) => ({
          q: v.faqQ(i) || base.faq[i]?.q || "",
          a: v.faqA || base.faq[i]?.a || "",
        })).filter((f) => f.q)
      : [],
    cta: base.cta,
    sectionOrder: style.sections,
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


/**
 * Seeds an empty video block above the copy for the types whose whole point is the video.
 *
 * A VSL template without somewhere for the video would be the same scaffolding as a squeeze page
 * with a different headline — the block is the reason these two types became buildable at all.
 * It ships with no source: an empty video renders nothing, so an unfinished page never shows a
 * broken player to real traffic.
 */
function withVideoBlock(tree: PageBlockTree, headline: string): PageBlockTree {
  const first = tree.blocks[0];
  if (!first || first.type !== "section") return tree;
  const video = {
    id: `video-${headline.length}`,
    type: "video" as const,
    style: {},
    content: { source: null, title: headline },
  };
  // After the heading, before the body copy — where a viewer expects it on a video page.
  const children = [...first.children];
  const insertAt = children[0]?.type === "heading" ? 1 : 0;
  children.splice(insertAt, 0, video as (typeof children)[number]);
  return { ...tree, blocks: [{ ...first, children }, ...tree.blocks.slice(1)] };
}

/** Which starting layout — one of the six styles, or an empty page. */

/**
 * Drops the sections a style left out.
 *
 * normalizePageCopy always emits all five legacy sections — resolveSectionOrder appends every
 * missing key by design, which is right for the AI path (a model that skips a field still gets a
 * complete page) and wrong here. Without this, "Minimal" shipped with an empty "How it works", an
 * empty "What you get" and an empty "Questions" — three headings introducing nothing.
 *
 * Prunes in two passes because order matters: empty content first, then any heading left
 * introducing nothing (trailing, or immediately followed by another heading).
 */
function pruneEmptySections(tree: PageBlockTree): PageBlockTree {
  const first = tree.blocks[0];
  if (!first || first.type !== "section") return tree;

  const hasContent = (b: any): boolean => {
    if (b.type === "subheading") return true; // decided in the second pass
    if (b.type === "paragraph" || b.type === "heading") return !!(b.content?.text ?? "").trim();
    if (b.type === "bullet_list") return (b.content?.items ?? []).some((i: string) => i.trim());
    if (b.type === "faq_item") return !!(b.content?.question ?? "").trim();
    return true; // images, video, dividers — presence is the content
  };

  const kept = first.children.filter(hasContent);
  const final = kept.filter((b: any, i: number) => {
    if (b.type !== "subheading") return true;
    const next = kept[i + 1] as any;
    return !!next && next.type !== "subheading";
  });

  return { ...tree, blocks: [{ ...first, children: final }, ...tree.blocks.slice(1)] };
}

export type FunnelStart = FunnelStyleId | "scratch";

/** The opt-in (bridge) page's starting content for a given funnel type. */
export function optInPageCopy(
  typeKey: string,
  /** A style id, or "scratch" for an empty page. */
  start: FunnelStart,
  title: string,
  imageDataUrl: string | null
): PageBlockTree {
  if (start === "scratch") return blankTree();
  const t = TEMPLATES[typeKey];
  const style = funnelStyle(start);
  // An unknown type or style falls back to blank rather than to another one's copy — a squeeze
  // page's words on a funnel someone asked to be something else is worse than an empty page.
  if (!t || !style) return blankTree();
  const filled = styled(fill(t, title), style);
  const tree = pruneEmptySections(normalizePageCopy(filled, style.mediaFirst ? imageDataUrl : null));
  // Video-first types always get a player; styles that open with words put it under the lead.
  return VIDEO_FIRST_TYPES.has(typeKey) ? withVideoBlock(tree, filled.headline) : tree;
}

/** A step page's starting content. */
export function stepPageCopy(
  stepType: FunnelStepType,
  start: FunnelStart,
  title: string
): PageBlockTree {
  if (start === "scratch") return blankTree(stepType);
  // Steps deliberately ignore the style: a thank-you page has one job whatever shape the opt-in
  // page took, and restyling it would mean six variants of "check your inbox".
  return normalizePageCopy(fill(STEP_TEMPLATES[stepType], title), null, { stepType });
}

/** The step types a funnel type creates after its opt-in page, or null if the type isn't real. */
export function stepsForType(typeKey: string): FunnelStepType[] | null {
  const def = funnelType(typeKey);
  return def ? def.steps : null;
}
