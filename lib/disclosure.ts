// Recognising an affiliate disclosure written into body copy.
//
// The disclosure itself is CODE-OWNED — DISCLOSURE in lib/engine/renderPages.ts, rendered as a
// locked block that renderBlockTree hoists to the end of every page, and markdownToBlockTree
// appends to every blog post. That guarantees content rule 3 and guarantees placement.
//
// This module exists for the copy the MODEL writes anyway. It has done so repeatedly: CLAUDE.md
// records it prepending "Affiliate Disclosure: …" to the lead paragraph on 3 of 15 campaigns, and
// the blog prompt used to ask for one outright ("near the top or bottom"). Two consequences, both
// bad and both invisible:
//
//   * The page shows the same notice twice, once wherever the model put it and once in the footer.
//   * It becomes the META DESCRIPTION. Both excerpt derivations take the opening prose, so an
//     article whose first paragraph is a disclosure is published to search results and link
//     previews as "This post contains affiliate links…" — the least useful sentence available,
//     in the one place that decides whether anyone clicks.
//
// Detection is deliberately CONSERVATIVE, and matches on a co-occurrence rather than a keyword.
// "affiliate" alone appears in legitimate copy constantly ("affiliate marketing", "an affiliate of
// …"), and a false positive here silently deletes a paragraph of someone's article — much worse
// than a disclosure surviving one extra render. So a paragraph has to pair an affiliate/commission
// term WITH a disclosure-shaped clause, or open with an explicit label.

const LABEL = /^\s*(affiliate\s+disclosure|disclosure|disclaimer|advertising\s+disclosure|ad\s+disclosure)\s*[:.—-]/i;

const AFFILIATE_TERM = /\b(affiliate\s+link|affiliate\s+links|affiliate\s+commission|commission|compensated|paid\s+partnership)\b/i;

const DISCLOSURE_CLAUSE =
  /\b(at\s+no\s+(extra|additional)\s+cost|no\s+extra\s+cost\s+to\s+you|i\s+may\s+earn|we\s+may\s+earn|may\s+receive\s+a\s+commission|earn\s+a\s+commission|if\s+you\s+(buy|purchase)\s+through)\b/i;

/** Does this paragraph read as an affiliate disclosure rather than as article copy? */
export function isDisclosureText(raw: unknown): boolean {
  const text = (typeof raw === "string" ? raw : "").trim();
  if (!text) return false;
  // A long passage that merely mentions commission somewhere is an article about affiliate
  // marketing, not a disclosure. Real disclosures are one or two sentences.
  if (text.length > 400) return false;
  if (LABEL.test(text)) return true;
  return AFFILIATE_TERM.test(text) && DISCLOSURE_CLAUSE.test(text);
}

/**
 * Cut a LABELLED disclosure off the end of an otherwise-real paragraph.
 *
 * The model does not only write disclosures as their own block. Observed live on two published
 * funnels: a genuine closing paragraph ("…so you know exactly what you're making before you
 * start.") with "Affiliate Disclosure: …" welded onto the end of it. A block-level filter is
 * right to leave those alone — the paragraph is real copy — so removing the duplicate needs a cut
 * inside the string.
 *
 * Deliberately anchored on an EXPLICIT LABEL and nothing else. Trying to detect an unlabelled
 * trailing disclosure sentence would mean guessing where a paragraph's last real sentence ends,
 * and being wrong deletes someone's closing line off a page taking paid traffic. A label is
 * unambiguous; anything less is left alone, and the duplicate is a smaller harm than the cut.
 *
 * Refuses to fire if what remains is too short to be the paragraph it started as — that shape
 * means the block was a disclosure all along, which is stripDisclosureParagraphs' job.
 */
const TRAILING_LABEL = /\s*\n*\s*(affiliate\s+disclosure|disclosure)\s*[:.—-]\s[\s\S]*$/i;
const MIN_PARAGRAPH_REMAINDER = 80;

export function stripTrailingDisclosureSentence(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : "";
  if (!TRAILING_LABEL.test(text)) return null;
  const kept = text.replace(TRAILING_LABEL, "").trimEnd();
  if (kept.length < MIN_PARAGRAPH_REMAINDER) return null;
  return kept;
}

/**
 * Cut a PARENTHESISED disclosure out of the middle of a paragraph.
 *
 * The third shape found in real data, and the reason the other two aren't enough: a lead paragraph
 * ending "…worth knowing. (This page contains affiliate links, and we may earn a commission if you
 * make a purchase — at no extra cost to you.)" followed by real content. No label, so the trailing
 * cut correctly refuses; mostly real copy, so the block filter correctly refuses.
 *
 * Safe to cut precisely BECAUSE it is parenthesised: the brackets delimit the aside unambiguously,
 * so there is no guess about where it starts or ends — which is exactly what makes the unlabelled
 * non-parenthesised case too dangerous to attempt. Nested brackets are not handled; a disclosure
 * containing its own parentheses is not a shape worth speculating about.
 */
const PARENTHETICAL = /\s*[([]([^()[\]]{20,400})[)\]]/g;

export function stripParentheticalDisclosure(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : "";
  if (!text) return null;
  let hit = false;
  const next = text.replace(PARENTHETICAL, (whole, inner) => {
    if (!isDisclosureText(inner)) return whole;
    hit = true;
    return "";
  });
  if (!hit) return null;
  const cleaned = next.replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return cleaned.length >= MIN_PARAGRAPH_REMAINDER ? cleaned : null;
}

/**
 * Remove disclosure paragraphs from generated markdown.
 *
 * Whole blocks only — never a sentence spliced out of a paragraph. Cutting mid-paragraph is how
 * you end up with copy that reads as though a clause went missing, which is worse than the
 * duplicate it was meant to fix, and it is not reversible by reading the result.
 */
export function stripDisclosureParagraphs(md: string): string {
  if (typeof md !== "string" || !md) return md;
  const blocks = md.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const kept = blocks.filter((b) => !isDisclosureText(b.replace(/^[>*_\s]+|[*_\s]+$/g, "")));
  // If that would empty the document, the detector is wrong about this input — keep the original.
  // An article is never worth losing to a heuristic.
  return kept.join("\n\n").trim() ? kept.join("\n\n") : md;
}

/**
 * Every disclosure removal, applied to one field of model-written copy.
 *
 * Used on generated page copy before it is normalized into a tree. The prompt already forbids
 * writing a disclosure, and the model does it anyway — measured across three distinct shapes on
 * live pages: its own paragraph, welded onto the end of one, and parenthesised mid-paragraph. A
 * prompt is a request; this is the enforcement, the same split as `withOfferLinks` appending a CTA
 * when the model ignores the placeholder instruction.
 *
 * Returns the input unchanged when nothing matches, so it is safe to call on every field.
 *
 * ORDER IS LOAD-BEARING: the surgical cuts run FIRST, and only what survives them is tested as a
 * whole. Testing first destroys real copy — a 280-character lead paragraph ending in a
 * parenthesised disclosure trips isDisclosureText (short enough, and it pairs "affiliate links"
 * with "at no extra cost"), so a leading whole-text check returned "" and deleted the entire
 * paragraph. Caught by a test, not by review, and it is exactly the false-positive class the
 * conservative detection at the top of this file exists to avoid.
 */
export function stripDisclosureFromCopy(raw: unknown): string {
  let text = typeof raw === "string" ? raw : "";
  if (!text) return "";
  const trailing = stripTrailingDisclosureSentence(text);
  if (trailing !== null) text = trailing;
  const paren = stripParentheticalDisclosure(text);
  if (paren !== null) text = paren;
  // Only now: if what is left is nothing but a disclosure, the field was one all along.
  return isDisclosureText(text) ? "" : text;
}
