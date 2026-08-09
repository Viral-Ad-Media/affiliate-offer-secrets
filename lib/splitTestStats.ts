// Split-test statistics. Pure functions, no I/O — same shape as lib/bridgeVariants.ts, and for the
// same reason: the maths is the part worth being able to test on its own.
//
// WHAT THIS ANSWERS, and why it's phrased that way. The number shown is P(variant converts better
// than control) under a Beta-Binomial model — literally "the chance this one is better", not a
// p-value. That choice is deliberate: a p-value answers "how surprising would this data be if the
// two were identical", which is not the question anyone using this page is asking, and it is
// misread as "chance the variant wins" so reliably that showing it under that label would be
// worse than showing nothing. The Bayesian quantity IS the thing people already think a
// confidence score means.
//
// WHAT IT DOESN'T DO. It never says "significant", never declares a winner, and refuses to print
// a number at all until there is enough data to mean something (see MIN_* below). A page showing
// "97%" off three conversions is the specific failure this exists to prevent — that is how tests
// get ended on noise.

/** Beta(1,1) — a uniform prior. Says "any conversion rate is equally plausible before any data". */
const PRIOR_ALPHA = 1;
const PRIOR_BETA = 1;

/**
 * How much data before a number is shown at all. Both are judgement calls, not derived constants —
 * there is no sample size that makes a test "valid", only ones that make the answer less noisy.
 * They are set where a lead-capture page with a typical opt-in rate reaches them in a day or two
 * of real ad traffic, so the gate informs rather than blocks.
 */
export const MIN_VISITORS_PER_ARM = 100;
export const MIN_CONVERSIONS_TOTAL = 10;

/** log Γ(x), Lanczos approximation (g=7, n=9). Accurate to ~15 significant figures for x > 0. */
function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula — keeps the approximation on the half of the domain it is good on.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log B(a,b), the log Beta function. */
function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Standard normal CDF, via the Abramowitz & Stegun 7.1.26 erf approximation. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Beyond this many conversions on the variant, the exact sum below is replaced by a normal
 * approximation. The exact form costs one iteration per variant conversion, and at these counts
 * the two agree to far more precision than a percentage rounded for display — so this is a speed
 * guard, not a change of answer.
 */
const EXACT_SUM_LIMIT = 2000;

/**
 * P(variant's true conversion rate > control's), given each arm's conversions and visitors.
 *
 * Exact closed form for Beta posteriors with integer parameters:
 *   P(B>A) = Σ_{i=0}^{αB-1} exp( lnB(αA+i, βA+βB) − ln(βB+i) − lnB(1+i, βB) − lnB(αA, βA) )
 * Summed in log space throughout, because the individual Beta terms underflow to zero in double
 * precision long before the sum does.
 */
export function probabilityToBeatControl(
  variant: { conversions: number; visitors: number },
  control: { conversions: number; visitors: number }
): number {
  const cA = Math.max(0, Math.floor(control.conversions));
  const nA = Math.max(0, Math.floor(control.visitors));
  const cB = Math.max(0, Math.floor(variant.conversions));
  const nB = Math.max(0, Math.floor(variant.visitors));

  // Conversions can exceed visitors in real data: `views` and the lead count are written by
  // different paths, and a visitor whose cookie survives past the 30-day window (or who opts in
  // from a shared link) can convert without adding a view. Clamp rather than return NaN — a
  // stats panel must not go blank because one number ran ahead of another.
  const convA = Math.min(cA, nA);
  const convB = Math.min(cB, nB);

  const alphaA = PRIOR_ALPHA + convA;
  const betaA = PRIOR_BETA + (nA - convA);
  const alphaB = PRIOR_ALPHA + convB;
  const betaB = PRIOR_BETA + (nB - convB);

  if (alphaB - 1 > EXACT_SUM_LIMIT) {
    // Normal approximation to the difference of two Beta posteriors. Their means and variances are
    // exact; at these counts both are near-Gaussian, so the difference is too.
    const meanA = alphaA / (alphaA + betaA);
    const meanB = alphaB / (alphaB + betaB);
    const varOf = (a: number, b: number) => (a * b) / ((a + b) * (a + b) * (a + b + 1));
    const sd = Math.sqrt(varOf(alphaA, betaA) + varOf(alphaB, betaB));
    if (sd === 0) return meanB > meanA ? 1 : meanB < meanA ? 0 : 0.5;
    return clamp01(normalCdf((meanB - meanA) / sd));
  }

  const lnBetaA = logBeta(alphaA, betaA);
  let total = 0;
  for (let i = 0; i < alphaB; i++) {
    const term = logBeta(alphaA + i, betaA + betaB) - Math.log(betaB + i) - logBeta(1 + i, betaB) - lnBetaA;
    total += Math.exp(term);
  }
  return clamp01(total);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export type VariantVerdict =
  /** Not enough data to say anything yet. `needVisitors` is how many more the thinner arm needs. */
  | { kind: "early"; needVisitors: number; needConversions: number }
  /** `probability` is P(this variant beats control), 0-1. */
  | { kind: "result"; probability: number };

/**
 * The verdict for ONE variant against the control, gate included.
 *
 * The gate is the whole point. Without it this returns a confident-looking number from three
 * conversions, and a number that looks confident is acted on — which is precisely how a test gets
 * called on noise. Below the threshold it reports what is still missing instead.
 */
export function variantVerdict(
  variant: { conversions: number; visitors: number },
  control: { conversions: number; visitors: number }
): VariantVerdict {
  const thinnestArm = Math.min(variant.visitors, control.visitors);
  const conversionsTotal = variant.conversions + control.conversions;

  if (thinnestArm < MIN_VISITORS_PER_ARM || conversionsTotal < MIN_CONVERSIONS_TOTAL) {
    return {
      kind: "early",
      needVisitors: Math.max(0, MIN_VISITORS_PER_ARM - thinnestArm),
      needConversions: Math.max(0, MIN_CONVERSIONS_TOTAL - conversionsTotal),
    };
  }
  return { kind: "result", probability: probabilityToBeatControl(variant, control) };
}

/**
 * Plain-language reading of a probability. Nothing here says "significant" or "winner": the
 * decision belongs to the person, and the honest summary of 0.93 is "probably better", not "ship
 * it". `strong` is what a UI should colour — 0.95/0.05 is the conventional line, offered as a
 * label rather than a verdict.
 */
export function describeProbability(p: number): { label: string; strong: boolean; losing: boolean } {
  if (p >= 0.95) return { label: "Clearly ahead", strong: true, losing: false };
  if (p >= 0.8) return { label: "Probably ahead", strong: false, losing: false };
  if (p > 0.2) return { label: "Too close to call", strong: false, losing: false };
  if (p > 0.05) return { label: "Probably behind", strong: false, losing: true };
  return { label: "Clearly behind", strong: true, losing: true };
}

/**
 * With several variants running, the best-looking one looks better than it is — someone has to win
 * the coin-tossing even when every page is identical. This is a note for the reader rather than a
 * correction to the numbers: each P(beats control) above is individually correct, and what needs
 * adjusting is how hard you lean on the maximum of several, which is a judgement, not arithmetic.
 */
export function needsMultipleComparisonsNote(nonControlVariants: number): boolean {
  return nonControlVariants >= 2;
}
