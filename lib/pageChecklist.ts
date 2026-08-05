import type { PageBlockTree, Block, ElementBlock, LockedBlock } from "@/lib/engine/renderPages";
import type { FunnelStepType } from "@/lib/shared";
import { isStarterCopy } from "@/lib/funnelTemplates";

/**
 * What a page of a given kind still needs, checked against what's actually on it.
 *
 * The point is that "required" here means required BY THE FUNNEL TYPE, not by the schema. The
 * validator already enforces everything that would break a page; nothing in this file can stop a
 * save, and it must not — someone half-way through building a webinar page has an incomplete page
 * on purpose. So these are `severity` hints, and the copy says why the element earns its place
 * rather than just naming it. A checklist that only says "add a video" teaches nobody anything.
 *
 * Every item is DERIVED from the current tree on every render, never stored. Same reasoning as the
 * workspace setup checklist (0073): a stored flag would keep saying "has a form" after the form was
 * deleted, and every edit path would have to remember to clear it.
 */

export type ChecklistSeverity = "required" | "recommended";

export type ChecklistItem = {
  key: string;
  label: string;
  /** Why this element matters for this page kind — the part a bare checklist never tells you. */
  why: string;
  severity: ChecklistSeverity;
  done: boolean;
};

/** Every block on the page, flattened — sections, rows, columns and locked blocks alike. */
function allBlocks(tree: PageBlockTree | null | undefined): Block[] {
  const out: Block[] = [];
  for (const b of tree?.blocks ?? []) {
    out.push(b);
    if (b.type !== "section") continue;
    for (const c of b.children) {
      out.push(c);
      if (c.type !== "row") continue;
      for (const col of c.columns) for (const el of col.children) out.push(el);
    }
  }
  return out;
}

function has(blocks: Block[], type: string): boolean {
  return blocks.some((b) => b.type === type);
}

function hasAny(blocks: Block[], types: string[]): boolean {
  return blocks.some((b) => types.includes(b.type));
}

function countOf(blocks: Block[], type: string): number {
  return blocks.filter((b) => b.type === type).length;
}

function wordsIn(s: unknown): number {
  return typeof s === "string" ? s.trim().split(/\s+/).filter(Boolean).length : 0;
}

/**
 * A block of one of `types` that actually SAYS something — at least `minWords` of real text.
 *
 * Presence was the wrong test and it let a page through: a funnel built from the "Scratch" layout
 * has a heading block with `text: ""`, so "A headline" ticked on an empty <h1> and the page was
 * publishable with nothing on it. Same reasoning as hasVisibleMedia — the checklist has to ask
 * whether a visitor would SEE the thing, not whether the block exists in the tree.
 */
function hasTextBlock(blocks: Block[], types: string[], minWords = 1): boolean {
  return blocks.some((b) => {
    if (!types.includes(b.type)) return false;
    const c = (b as ElementBlock).content as Record<string, unknown> | undefined;
    return wordsIn(c?.text) >= minWords;
  });
}

/** A list block with at least one non-empty entry. */
function hasFilledList(blocks: Block[]): boolean {
  return blocks.some((b) => {
    if (b.type !== "bullet_list" && b.type !== "icon_list") return false;
    const items = ((b as ElementBlock).content as Record<string, unknown>)?.items;
    if (!Array.isArray(items)) return false;
    return items.some((i) =>
      typeof i === "string" ? i.trim().length > 0 : wordsIn((i as Record<string, unknown>)?.text) > 0
    );
  });
}

/**
 * A block that will actually SHOW something, not just an empty placeholder.
 *
 * This matters more than it looks: the renderer deliberately emits nothing for an image with no
 * dataUrl or a video with no source, so counting bare inserted blocks would tick "An image" for a
 * page that renders none — the checklist would be lying about the exact thing it exists to catch.
 */
function hasVisibleMedia(blocks: Block[]): boolean {
  return blocks.some((b) => {
    const c = (b as ElementBlock).content as Record<string, unknown> | undefined;
    if (!c) return false;
    if (b.type === "image") return !!c.dataUrl;
    if (b.type === "video") return !!c.source;
    if (b.type === "image_list" || b.type === "carousel") {
      const items = (c.items ?? c.slides) as unknown;
      return Array.isArray(items) && items.some((i) => i && typeof i === "object" && (i as Record<string, unknown>).imageDataUrl);
    }
    return false;
  });
}

/** A testimonial with something actually in it — an empty one renders nothing. */
function hasRealTestimonial(blocks: Block[]): boolean {
  return blocks.some((b) => {
    if (b.type !== "testimonial") return false;
    const c = (b as ElementBlock).content as Record<string, unknown>;
    return typeof c?.quote === "string" && c.quote.trim().length > 0;
  });
}

/** Any form a visitor can submit — the locked opt-in one or a dropped-in standalone form. */
function hasForm(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === "form" || (b as LockedBlock).locked === "lead_capture_form");
}

/**
 * Button labels that are the template's own default, or so generic they say nothing. A squeeze
 * page's button is one of about four things on it, so "Continue" is a wasted line rather than a
 * small blemish — hence this is a required item there and nowhere else.
 *
 * Matched on the whole trimmed label, never as a substring: "Continue to my free guide" is a
 * perfectly good button and must not be caught by "continue".
 */
const GENERIC_CTA_LABELS = new Set([
  "continue",
  "submit",
  "send",
  "sign up",
  "subscribe",
  "next",
  "go",
  "click here",
  "get started",
  "download",
]);

/** The form's submit label, from the locked opt-in form or a standalone form block. */
function hasSpecificFormCta(blocks: Block[]): boolean {
  return blocks.some((b) => {
    const locked = (b as LockedBlock).locked;
    if (b.type !== "form" && locked !== "lead_capture_form") return false;
    const c = (b as ElementBlock).content as Record<string, unknown> | undefined;
    const label = (locked === "lead_capture_form" ? c?.ctaText : c?.submitText) as unknown;
    if (typeof label !== "string") return false;
    const t = label.trim().toLowerCase().replace(/[.!…]+$/, "");
    return t.length > 0 && !GENERIC_CTA_LABELS.has(t);
  });
}

/** Fields the tenant added beyond the name/email the form renders itself. */
function extraFieldCount(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.type === "form" || (b as LockedBlock).locked === "lead_capture_form") {
      n += ((b as { children?: unknown[] }).children ?? []).length;
    }
  }
  return n;
}

/** Rough word count of the page's own copy, for "is there actually anything here" checks. */
export function treeWordCount(tree: PageBlockTree | null | undefined): number {
  let words = 0;
  const add = (s: unknown) => {
    if (typeof s === "string") words += s.trim().split(/\s+/).filter(Boolean).length;
  };
  for (const b of allBlocks(tree)) {
    const c = (b as ElementBlock).content as Record<string, unknown> | undefined;
    if (!c) continue;
    add(c.text);
    add(c.title);
    add(c.question);
    add(c.answer);
    add(c.quote);
    add(c.caption);
    if (Array.isArray(c.items)) {
      for (const it of c.items) {
        if (typeof it === "string") add(it);
        else if (it && typeof it === "object") {
          add((it as Record<string, unknown>).text);
          add((it as Record<string, unknown>).caption);
        }
      }
    }
  }
  return words;
}

function item(
  key: string,
  label: string,
  why: string,
  severity: ChecklistSeverity,
  done: boolean
): ChecklistItem {
  return { key, label, why, severity, done };
}

/**
 * How many verbatim-template blocks a page is allowed before it counts as unedited.
 *
 * TWO, not one, because a single match is genuinely ambiguous: one real AI-written campaign here
 * has the FAQ "How does it work?" — a sensible question that a template also happens to ask, and
 * failing an otherwise-original page over that collision would be the gate crying wolf. An
 * actually-untouched template matches on many blocks at once, so the signal is the cluster.
 */
const STARTER_BLOCKS_TOLERATED = 2;

/** Text-bearing blocks still saying exactly what the template put there. */
function starterBlockCount(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    // Locked blocks are skipped: their text is app-owned (the disclosure) or comes from the same
    // small set of defaults on every page ("Continue"), so matching them says nothing about
    // whether the tenant wrote their copy. The CTA's quality has its own check.
    if ((b as LockedBlock).locked) continue;
    const c = (b as ElementBlock).content as Record<string, unknown> | undefined;
    if (!c) continue;
    for (const key of ["text", "title", "question", "answer", "quote"] as const) {
      const v = c[key];
      if (typeof v === "string" && isStarterCopy(v)) n++;
    }
    if (Array.isArray(c.items)) {
      for (const it of c.items) {
        const v = typeof it === "string" ? it : (it as Record<string, unknown>)?.text;
        if (typeof v === "string" && isStarterCopy(v)) n++;
      }
    }
  }
  return n;
}

/**
 * "Write your own copy" — required, on every page kind that can come from a template.
 *
 * Deliberately counts rather than naming each block: the number is what tells you how much is
 * left, and a list of eight identical "still the starter text" rows would bury the rest of the
 * checklist. An AI-generated kit writes its own copy, so this ticks for those from the start.
 */
function starterCopyItem(blocks: Block[]): ChecklistItem {
  const n = starterBlockCount(blocks);
  return item(
    "starter",
    "Replace the starter copy",
    `${n} blocks still say exactly what the template put there. The starter text is a prompt written to you, not to a visitor.`,
    "required",
    n < STARTER_BLOCKS_TOLERATED
  );
}

/**
 * The opt-in (entry) page's checklist, by funnel type.
 *
 * A null/unknown type falls back to the generic list rather than rendering nothing — an older
 * funnel with no recorded type should still get told it has no headline.
 */
export function funnelPageChecklist(
  funnelType: string | null | undefined,
  tree: PageBlockTree | null | undefined
): ChecklistItem[] {
  const b = allBlocks(tree);
  const words = treeWordCount(tree);

  const headline = item(
    "headline",
    "A headline",
    "The first thing a visitor reads, and usually the only thing they read before deciding to stay. An empty heading block doesn't count.",
    "required",
    hasTextBlock(b, ["heading"])
  );
  const form = item(
    "form",
    "A form to capture the lead",
    "Without one the page can take traffic but never produce a contact.",
    "required",
    hasForm(b)
  );
  const cta = item(
    "cta",
    "A call to action",
    "The button that tells someone what happens next.",
    "required",
    hasAny(b, ["button"]) || b.some((x) => (x as LockedBlock).locked === "primary_cta")
  );
  const body = item(
    "body",
    "Body copy",
    "At least a short paragraph — a page with a headline and nothing else reads as broken, not minimal.",
    "required",
    has(b, "paragraph") && words >= 40
  );
  const benefits = item(
    "benefits",
    "A list of what they get",
    "Scannable bullets do the work for the majority of visitors who never read the paragraphs.",
    "recommended",
    hasFilledList(b)
  );
  const image = item(
    "image",
    "An image",
    "Something to look at — a bare wall of text converts worse than the same copy with one relevant image.",
    "recommended",
    hasVisibleMedia(b)
  );
  const proof = item(
    "proof",
    "Proof or a testimonial",
    "A specific, real claim someone else made carries more weight than anything you write about yourself.",
    "recommended",
    hasRealTestimonial(b)
  );
  const faq = item(
    "faq",
    "FAQ entries",
    "Answers the objections that otherwise get resolved by leaving.",
    "recommended",
    has(b, "faq_item")
  );
  const video = item(
    "video",
    "The video",
    "This funnel type IS the video — without it the page is a squeeze page with a different name.",
    "required",
    b.some((x) => x.type === "video" && !!((x as ElementBlock).content as Record<string, unknown>)?.source)
  );

  // Appended to every type. The starter copy is prompts, not claims — "Open with the problem your
  // reader already knows they have" is instructions to the author, and publishing it sends real ad
  // traffic to a page telling them to write something.
  const starter = starterCopyItem(b);

  const byType = ((): ChecklistItem[] => {
  switch (funnelType) {
    // Squeeze deliberately asks for MORE than the schema minimum, not less. Being the shortest
    // page type makes it the easiest to publish empty — headline + form alone is a blank page with
    // a box on it, and that is exactly what a scratch build produces. Everything required here is
    // something a visitor has to read before deciding to hand over an address.
    case "squeeze":
      return [
        headline,
        item(
          "promise",
          "The offer, in a line",
          "A subheading or short paragraph saying what they actually get. The headline alone is a claim; this is the thing being traded for their address.",
          "required",
          hasTextBlock(b, ["subheading", "paragraph"], 5)
        ),
        item(
          "whatTheyGet",
          "What's included",
          "Two or three bullets. On a page this short they're most of the copy, and they're what turns a vague promise into something specific.",
          "required",
          hasFilledList(b)
        ),
        form,
        item(
          "cta_text",
          "A button that says what happens",
          'The form\'s button text. "Continue" or "Submit" asks for an email and promises nothing — name the thing they get.',
          "required",
          hasSpecificFormCta(b)
        ),
        item(
          "short",
          "Keep it short",
          `A squeeze page trades one promise for an email. Under ~150 words is the whole idea; long copy belongs on a bridge page. Currently ${words}.`,
          "recommended",
          words > 0 && words <= 150
        ),
        image,
      ];

    case "bridge":
      return [headline, body, form, cta, benefits, image, proof, faq];

    case "summit":
      return [
        headline,
        item(
          "when",
          "The date, time and what it is",
          "Someone registering for an event needs to know when it is before they'll hand over an address.",
          "required",
          words >= 40 && has(b, "paragraph")
        ),
        form,
        benefits,
        image,
      ];

    case "application":
      return [
        headline,
        form,
        item(
          "qualifying",
          "Qualifying questions (3+)",
          "An application page exists to filter. With only name and email it's a squeeze page that wastes your call slots.",
          "required",
          extraFieldCount(b) >= 3
        ),
        item(
          "expectations",
          "What happens after they apply",
          "People abandon forms when they don't know what they're signing up for.",
          "recommended",
          has(b, "paragraph")
        ),
        proof,
      ];

    case "vsl":
      return [
        video,
        headline,
        cta,
        item(
          "below",
          "Copy under the video",
          "Not everyone presses play, and search engines never do.",
          "recommended",
          has(b, "paragraph")
        ),
        form,
        proof,
      ];

    case "webinar":
      return [
        headline,
        form,
        item(
          "learn",
          "What they'll learn",
          "The three things they walk away with is what actually gets a registration.",
          "required",
          hasAny(b, ["bullet_list", "icon_list"])
        ),
        item(
          "when",
          "When it runs",
          "A registration page with no time on it reads as an unfinished page.",
          "recommended",
          has(b, "paragraph")
        ),
        proof,
        image,
      ];

    default:
      return [headline, body, form, cta, benefits, image];
  }
  })();

  return [...byType, starter];
}

/** A post-opt-in step page, by step type. These have no lead form — the visitor is already a lead. */
export function funnelStepChecklist(
  stepType: FunnelStepType | null | undefined,
  tree: PageBlockTree | null | undefined
): ChecklistItem[] {
  const b = allBlocks(tree);
  const hasButton = has(b, "button") || b.some((x) => (x as LockedBlock).locked === "primary_cta");

  const headline = item(
    "headline",
    "A headline",
    "Tells someone immediately that the last step worked.",
    "required",
    hasTextBlock(b, ["heading"])
  );
  const starter = starterCopyItem(b);

  const byType = ((): ChecklistItem[] => {
  switch (stepType) {
    case "thank_you":
      return [
        headline,
        item(
          "next",
          "What to do next",
          "A thank-you page that only says thank you wastes the most attentive moment you'll ever get.",
          "required",
          hasButton
        ),
        item(
          "expect",
          "What to expect and when",
          "Sets up the email that's about to arrive, so it doesn't look like spam.",
          "recommended",
          has(b, "paragraph")
        ),
      ];

    case "upsell":
      return [
        headline,
        item(
          "offer",
          "What the offer is",
          "This is a second sale to someone who just converted — it needs its own pitch, not just a price.",
          "required",
          has(b, "paragraph")
        ),
        item(
          "accept",
          "An accept button",
          "The action that takes the upsell.",
          "required",
          hasButton
        ),
        item(
          "decline",
          "A visible decline link",
          "Required by the page's own template, and hiding it is the pattern that gets ad accounts flagged.",
          "required",
          b.some((x) => (x as LockedBlock).locked === "decline_link")
        ),
        item(
          "value",
          "What's included",
          "Bullets beat a paragraph when someone is deciding in seconds.",
          "recommended",
          hasAny(b, ["bullet_list", "icon_list"])
        ),
      ];

    case "order":
      return [
        headline,
        item(
          "included",
          "What's included",
          "The order page is the last chance to restate what they're getting.",
          "required",
          hasAny(b, ["bullet_list", "icon_list"])
        ),
        item("cta", "A button to the checkout", "Where the actual purchase happens.", "required", hasButton),
        item(
          "reassurance",
          "Guarantee or reassurance",
          "The most common reason a filled-in order page is abandoned is a last-second doubt.",
          "recommended",
          has(b, "paragraph")
        ),
      ];

    default:
      return [headline, item("cta", "A call to action", "What the visitor does next.", "required", hasButton)];
  }
  })();

  return [...byType, starter];
}

/** A blog post. Takes the fields that live outside the tree, since they're half of what a post needs. */
export function blogPostChecklist(input: {
  tree: PageBlockTree | null | undefined;
  title: string;
  excerpt?: string | null;
  seoDescription?: string | null;
  featuredImageUrl?: string | null;
  categoryId?: string | null;
}): ChecklistItem[] {
  const b = allBlocks(input.tree);
  const words = treeWordCount(input.tree);

  return [
    item("title", "A title", "It's the link text in search results and on the blog index.", "required", input.title.trim().length > 0),
    item(
      "body",
      "At least 300 words",
      `Currently ${words}. Shorter than this rarely ranks for anything and rarely answers the question that brought someone in.`,
      "required",
      words >= 300
    ),
    item(
      "subheads",
      "Subheadings",
      "People scan before they read; subheadings are also what search engines use to understand structure.",
      "required",
      countOf(b, "heading") + countOf(b, "subheading") >= 2
    ),
    item(
      "featured",
      "A featured image",
      "It's the card thumbnail on the index and the preview when the post is shared — without one both look empty.",
      "required",
      !!input.featuredImageUrl
    ),
    item(
      "category",
      "A category",
      "Categories are how the index filters, and an uncategorised post is reachable only by its direct link.",
      "recommended",
      !!input.categoryId
    ),
    item(
      "excerpt",
      "An excerpt or meta description",
      "Written by you, or the search engine writes one for you out of whatever text it finds first.",
      "recommended",
      !!(input.excerpt?.trim() || input.seoDescription?.trim())
    ),
    item(
      "image",
      "An image in the body",
      "Breaks up a long read and gives the post something to show beyond the hero.",
      "recommended",
      hasVisibleMedia(b)
    ),
  ];
}

/** Counts for the section header — "3 of 5" is only meaningful about the required ones. */
export function checklistProgress(items: ChecklistItem[]): {
  requiredDone: number;
  requiredTotal: number;
  allDone: boolean;
} {
  const req = items.filter((i) => i.severity === "required");
  const requiredDone = req.filter((i) => i.done).length;
  return {
    requiredDone,
    requiredTotal: req.length,
    allDone: items.every((i) => i.done),
  };
}
