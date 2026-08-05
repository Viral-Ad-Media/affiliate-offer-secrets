import type { SectionKey } from "@/lib/engine/renderPages";

/**
 * Page styles — six starting layouts every funnel type can be built in.
 *
 * A style is a STRUCTURE, not a coat of paint: which sections appear, in what order, and how the
 * scaffold copy is pitched. That's the difference that actually matters when you're picking a
 * starting point. Six variations of the same page with different adjectives would be a menu that
 * looks like a choice and isn't.
 *
 * Composed against the funnel type's own subject matter rather than written out 6 x 6 times: the
 * TYPE decides what the page is about (a squeeze page's headline is about a free resource, a
 * webinar's is about a session), the STYLE decides how it's laid out and how the prompts read. 36
 * hand-written blobs would drift apart the first time anyone edited one of them.
 *
 * Every style still carries the locked compliance blocks — they're appended by normalizePageCopy
 * downstream, not by anything here, so a style cannot accidentally omit the disclosure.
 */

export type FunnelStyleId = "direct" | "advertorial" | "story" | "authority" | "minimal" | "visual";

export type FunnelStyle = {
  id: FunnelStyleId;
  label: string;
  /** One line in the picker — what this shape is for, not what it looks like. */
  blurb: string;
  /** Which sections render, in this order. Omitted keys are dropped entirely, not left blank. */
  sections: SectionKey[];
  /** How many benefit bullets the scaffold seeds — a stack page wants more than a minimal one. */
  bullets: number;
  /** How many FAQ entries. 0 means the section is dropped even if it's listed above. */
  faqs: number;
  /** Sets the tone of the placeholder prompts, so a story page doesn't ask for feature bullets. */
  voice: "punchy" | "editorial" | "personal" | "measured" | "spare" | "captioned";
  /** Video-first types seed their player above the copy in every style; this moves it below the
   *  lead for styles that open with words instead. */
  mediaFirst: boolean;
};

export const FUNNEL_STYLES: FunnelStyle[] = [
  {
    id: "direct",
    label: "Direct response",
    blurb: "Claim, proof, offer. Short page, one decision, nothing to scroll past.",
    sections: ["lead", "benefits", "proof"],
    bullets: 3,
    faqs: 0,
    voice: "punchy",
    mediaFirst: true,
  },
  {
    id: "advertorial",
    label: "Advertorial",
    blurb: "Reads like an article, ends at your offer. The long version, for cold traffic.",
    sections: ["lead", "mechanism", "benefits", "proof", "faq"],
    bullets: 4,
    faqs: 3,
    voice: "editorial",
    mediaFirst: false,
  },
  {
    id: "story",
    label: "Story-led",
    blurb: "Opens with what happened to you. Warmest for an audience that knows you.",
    sections: ["lead", "mechanism", "proof", "benefits"],
    bullets: 3,
    faqs: 1,
    voice: "personal",
    mediaFirst: false,
  },
  {
    id: "authority",
    label: "Authority",
    blurb: "How it works first, credentials up front. For a sceptical or technical reader.",
    sections: ["mechanism", "proof", "benefits", "faq"],
    bullets: 4,
    faqs: 4,
    voice: "measured",
    mediaFirst: false,
  },
  {
    id: "minimal",
    label: "Minimal",
    blurb: "Headline, one paragraph, the form. Nothing else on the page to lose them to.",
    sections: ["lead"],
    bullets: 0,
    faqs: 0,
    voice: "spare",
    mediaFirst: true,
  },
  {
    id: "visual",
    label: "Visual",
    blurb: "Carried by images or video, with captions instead of paragraphs.",
    sections: ["lead", "benefits"],
    bullets: 5,
    faqs: 0,
    voice: "captioned",
    mediaFirst: true,
  },
];

export function funnelStyle(id: string): FunnelStyle | null {
  return FUNNEL_STYLES.find((s) => s.id === id) ?? null;
}

export function isFunnelStyleId(v: unknown): v is FunnelStyleId {
  return typeof v === "string" && FUNNEL_STYLES.some((s) => s.id === v);
}

/**
 * Placeholder copy, per section, per voice.
 *
 * These are PROMPTS to whoever edits the page, never claims — the same rule the type templates
 * follow. A template that asserted a benefit would be putting words in an affiliate's mouth on a
 * page carrying their disclosure.
 */
export const VOICE_PROMPTS: Record<
  FunnelStyle["voice"],
  { lead: string; mechanism: string; proof: string; bullet: (n: number) => string; faqQ: (n: number) => string; faqA: string }
> = {
  punchy: {
    lead: "One sentence: what they get, and why now. Cut everything else.",
    mechanism: "Why this works, in two lines. No preamble.",
    proof: "One number or one result you can actually stand behind.",
    bullet: (n) => ["What they get", "How fast", "What it costs them"][n] ?? `Point ${n + 1}`,
    faqQ: (n) => `Question ${n + 1}`,
    faqA: "Answer it in one line.",
  },
  editorial: {
    lead: "Open on the reader's situation, in their words. Don't mention the offer yet.",
    mechanism: "Explain what's actually going on — the part most articles skip.",
    proof: "What you've seen work, stated plainly. Leave out anything you can't back up.",
    bullet: (n) =>
      ["What changes first", "What it takes", "What it doesn't require", "What to expect by week two"][n] ??
      `Point ${n + 1}`,
    faqQ: (n) =>
      ["What does it cost?", "How long before it works?", "What if it isn't for me?", "Is there support?"][n] ??
      `Question ${n + 1}`,
    faqA: "Answer honestly — a surprise later costs more than the answer does now.",
  },
  personal: {
    lead: "Start where you were before any of this worked. First person.",
    mechanism: "What changed, and what you'd tell someone at the start.",
    proof: "Your own result, with the honest caveats attached.",
    bullet: (n) => ["What I tried first", "What finally moved", "What I'd skip"][n] ?? `Point ${n + 1}`,
    faqQ: (n) => ["Did this work for you?", "How long did it take?"][n] ?? `Question ${n + 1}`,
    faqA: "Answer as yourself, not as a brand.",
  },
  measured: {
    lead: "State the problem precisely, without adjectives.",
    mechanism: "The mechanism, step by step. This is the section this page is for.",
    proof: "Credentials, sources, or a result with its conditions stated.",
    bullet: (n) =>
      ["What it does", "What it doesn't do", "Who it suits", "Who it doesn't"][n] ?? `Point ${n + 1}`,
    faqQ: (n) =>
      ["How does it work?", "What's the evidence?", "Are there side effects or limits?", "Who shouldn't use it?"][n] ??
      `Question ${n + 1}`,
    faqA: "Answer specifically. Vagueness reads as evasion to this audience.",
  },
  spare: {
    lead: "One sentence. If it needs two, it needs a different style.",
    mechanism: "",
    proof: "",
    bullet: () => "",
    faqQ: (n) => `Question ${n + 1}`,
    faqA: "",
  },
  captioned: {
    lead: "A line to sit under the image or video. Short enough to read at a glance.",
    mechanism: "",
    proof: "",
    bullet: (n) =>
      ["Caption one", "Caption two", "Caption three", "Caption four", "Caption five"][n] ?? `Caption ${n + 1}`,
    faqQ: (n) => `Question ${n + 1}`,
    faqA: "",
  },
};
