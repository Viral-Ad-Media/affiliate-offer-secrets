// Pre-flight checks on ad copy, before you spend money finding out.
//
// ISOMORPHIC — pure functions over strings, no I/O. The panel runs it in the browser as you read.
//
// *** THIS IS NOT AN APPROVAL. *** It cannot be. Meta and TikTok review with classifiers and human
// reviewers against policies that change without notice, and no local regex knows what they will
// decide. What this does is catch the failures that are CHEAP to catch and expensive to discover:
// the phrasings this codebase's own content rules already forbid, the personal-attribute framing
// that gets health and wealth offers rejected on sight, and copy that will be silently truncated
// mid-sentence in the feed. Every finding says WHY, so it can be disagreed with.
//
// Length numbers come from Meta's own Ads Guide (facebook.com/business/ads-guide, Feed image ad),
// read rather than remembered — it states primary text 50-150 and headline 27. They are Meta's
// RECOMMENDATIONS, not API limits: longer copy is accepted and then truncated in the feed, which
// is why over-length is a warning about what the reader sees, never an error.

export type Severity = "block" | "warn" | "info";

export type Finding = {
  severity: Severity;
  /** What is wrong, in one line. */
  title: string;
  /** Why it matters — the reason a reviewer or a reader would care. */
  detail: string;
  /** Which field it came from, so the panel can point at it. */
  field: "headline" | "primary_text" | "description" | "creative" | "destination";
};

/** Meta's own stated guidance for a Feed image ad. */
export const META_PRIMARY_TEXT_RECOMMENDED = 150;
export const META_HEADLINE_RECOMMENDED = 27;

/**
 * Phrasings that get health and wealth offers rejected.
 *
 * Grounded in the same content rules the generator already follows (no invented results, no cure
 * claims, no income promises) plus Meta's prohibition on asserting or implying a personal
 * attribute. Word-boundary matched so "curated" isn't read as "cure" and "assured" isn't "sure".
 */
const CLAIM_PATTERNS: { re: RegExp; title: string; detail: string }[] = [
  {
    re: /\b(cure|cures|cured|heal|heals|reverses?)\b/i,
    title: "Reads as a medical claim",
    detail: "Cure/heal/reverse language is refused outright in health categories, whatever the sales page says.",
  },
  {
    re: /\b(guarantee[ds]?|guaranteed results|100%|risk[- ]free)\b/i,
    title: "Guarantees an outcome",
    detail: "A promised result is one of the most reliable rejection triggers, and it isn't traceable to the vendor's page.",
  },
  {
    // No \b before the currency alternative: \b requires a word character on one side, and "$" is
    // not one — so /\b\$\d+/ can NEVER match "$500". The pattern was silently dead until a test
    // fed it "Make $500 a day from home" and got nothing back.
    re: /(\$\s?\d[\d,]*\s*(?:a|per)\s*(?:day|week|month)|\bmake money fast\b|\bget rich\b)/i,
    title: "Promises specific earnings",
    detail: "Income claims need substantiation the vendor page almost never provides, and are policy-refused in most markets.",
  },
  {
    re: /\b(miracle|breakthrough|secret|shocking|doctors hate)\b/i,
    title: "Sensational framing",
    detail: "Classic affiliate phrasing that flags an ad for manual review even when the claim behind it is fine.",
  },
  {
    re: /\blose\s+\d+\s*(lbs?|pounds|kg|kilos?)\b/i,
    title: "Specific weight-loss figure",
    detail: "A numeric result is treated as a promise, and weight loss is one of the most heavily policed categories.",
  },
];

/**
 * Second person plus a condition — "your diabetes", "are you depressed" — which Meta reads as
 * asserting the viewer HAS that attribute. This is the rule most affiliate copy trips on, because
 * it feels like ordinary direct response.
 */
const PERSONAL_ATTRIBUTE = new RegExp(
  String.raw`\b(your|you're|you are|are you|do you (have|suffer))\b[^.?!]{0,40}\b(diabet\w*|arthrit\w*|anxiety|depress\w*|obes\w*|overweight|erectile|herpes|hiv|cancer|addict\w*|bankrupt\w*|debt|credit score)\b`,
  "i"
);

export type AdAngleLike = {
  headline?: string | null;
  primary_text?: string | null;
  description?: string | null;
};

/**
 * Checks one ad angle. `context` describes things the copy itself can't know.
 *
 * Ordered block → warn → info so the panel can render straight through, and a caller can gate a
 * launch button on `severity === "block"` without re-sorting.
 */
export function checkAdAngle(
  angle: AdAngleLike,
  context?: { hasCreative?: boolean; destinationPublished?: boolean }
): Finding[] {
  const findings: Finding[] = [];
  const headline = (angle.headline ?? "").trim();
  const primary = (angle.primary_text ?? "").trim();
  const description = (angle.description ?? "").trim();
  const all = `${headline}\n${primary}\n${description}`;

  // --- things that stop a launch working at all -------------------------------------------------
  if (context?.destinationPublished === false) {
    findings.push({
      severity: "block",
      field: "destination",
      title: "Landing page isn't published",
      detail: "Ad traffic would hit a 404. Publish the funnel before launching.",
    });
  }
  if (context?.hasCreative === false) {
    findings.push({
      severity: "block",
      field: "creative",
      title: "No creative generated",
      detail: "This angle has no image or video yet, so there is nothing to launch it with.",
    });
  }
  if (!headline) {
    findings.push({ severity: "block", field: "headline", title: "Headline is empty", detail: "Every ad needs one." });
  }
  if (!primary) {
    findings.push({ severity: "block", field: "primary_text", title: "Primary text is empty", detail: "Every ad needs one." });
  }

  // --- policy risk -------------------------------------------------------------------------------
  if (PERSONAL_ATTRIBUTE.test(all)) {
    findings.push({
      severity: "warn",
      field: "primary_text",
      title: "Implies the viewer has a personal condition",
      detail:
        "Meta prohibits asserting or implying a personal attribute — health, finances, and similar. Rewrite to describe the problem in the third person rather than addressing the reader's condition.",
    });
  }
  for (const p of CLAIM_PATTERNS) {
    if (p.re.test(all)) findings.push({ severity: "warn", field: "primary_text", title: p.title, detail: p.detail });
  }

  // Shouting. Two or more fully-capitalised words of real length — an acronym or a brand in caps
  // shouldn't trip this, which is why single words are ignored.
  const shouted = all.match(/\b[A-Z]{4,}\b/g) ?? [];
  if (shouted.length >= 2) {
    findings.push({
      severity: "warn",
      field: "primary_text",
      title: "Shouting in capitals",
      detail: `${shouted.slice(0, 3).join(", ")} — capitalised words read as spam to reviewers and to people.`,
    });
  }
  if ((all.match(/!/g) ?? []).length > 2) {
    findings.push({
      severity: "warn",
      field: "primary_text",
      title: "Heavy exclamation",
      detail: "More than a couple of exclamation marks is a low-quality signal on both platforms.",
    });
  }

  return findings;
}

/**
 * Character counts against Meta's recommendations.
 *
 * Deliberately NOT findings. Run over the 41 real generated angles, EVERY one exceeded both
 * numbers — because the generator was never told them — so as checklist items they fired 100% of
 * the time and buried the 9 angles with genuine rejection risk. A warning that always fires is one
 * people learn to scroll past, which is the exact trap this codebase already documents for the
 * "ads without a funnel" notice.
 *
 * Length is better SHOWN than listed: AdPreview strikes through the truncated tail, which answers
 * "does my hook survive the cut" in a way a number never does.
 */
export function measureAdAngle(angle: AdAngleLike): {
  headline: number;
  primaryText: number;
  headlineOver: boolean;
  primaryOver: boolean;
} {
  const headline = (angle.headline ?? "").trim().length;
  const primaryText = (angle.primary_text ?? "").trim().length;
  return {
    headline,
    primaryText,
    headlineOver: headline > META_HEADLINE_RECOMMENDED,
    primaryOver: primaryText > META_PRIMARY_TEXT_RECOMMENDED,
  };
}

/**
 * The policies these checks approximate. Linked rather than summarised: they change, and a stale
 * paraphrase in this codebase would be worse than a click.
 */
export const AD_POLICY_LINKS = [
  { label: "Meta Advertising Standards", href: "https://transparency.meta.com/policies/ad-standards/" },
  {
    label: "Meta: personal attributes",
    href: "https://transparency.meta.com/policies/ad-standards/content-specific-restrictions/personal-attributes",
  },
  { label: "TikTok Advertising Policies", href: "https://ads.tiktok.com/help/article/advertising-policies" },
  { label: "FTC endorsement & affiliate disclosure guides", href: "https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides" },
] as const;
