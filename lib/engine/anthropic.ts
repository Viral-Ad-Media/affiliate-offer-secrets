import Anthropic from "@anthropic-ai/sdk";
import { db } from "./core";

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    // timeout: the engine runs inside a 60s serverless function. The SDK's default (10 minutes)
    // means a long generation outlives the function — the platform kills the process mid-call,
    // Anthropic bills the full generation, recordUsage never runs, and the job retries the same
    // billed-but-invisible call (the Aug 18-19 incident). 45s makes the call fail INSIDE the
    // function: caught, recorded as a failed attempt, counted against MAX_ATTEMPTS.
    // maxRetries 0: the SDK's own silent retries (default 2) would each bill again within a
    // single job attempt and blow the invocation budget anyway — the worker's attempts loop is
    // the one retry mechanism, because it is the one that is counted and capped.
    _client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 0 });
  }
  return _client;
}

export const ENGINE_MODEL = "claude-sonnet-5";

// Introductory Sonnet 5 pricing, per million tokens, in effect through 2026-08-31 — revisit
// after that date. Cache writes carry the standard ~25% premium over base input; cache reads
// are billed at ~10% of base input. https://docs.anthropic.com/en/docs/about-claude/pricing
const PRICE_PER_MTOK_USD = {
  input: 2.0,
  output: 10.0,
  cacheWrite: 2.5,
  cacheRead: 0.2,
};

export type UsageContext = {
  userId: string;
  // Nullable because not every Anthropic call belongs to a job. Synchronous helpers the operator
  // triggers from a form (the AI broadcast drafter) still cost real tokens and still belong in the
  // ledger; usage_ledger.job_id has always been nullable, only this type insisted otherwise.
  jobId: string | null;
  jobType: string;
  stage: string;
};

async function recordUsage(ctx: UsageContext, model: string, usage: Anthropic.Usage) {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  const costUsd =
    (inputTokens / 1_000_000) * PRICE_PER_MTOK_USD.input +
    (outputTokens / 1_000_000) * PRICE_PER_MTOK_USD.output +
    (cacheWriteTokens / 1_000_000) * PRICE_PER_MTOK_USD.cacheWrite +
    (cacheReadTokens / 1_000_000) * PRICE_PER_MTOK_USD.cacheRead;

  const { error } = await db.from("usage_ledger").insert({
    user_id: ctx.userId,
    job_id: ctx.jobId,
    job_type: ctx.jobType,
    stage: ctx.stage,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_write_tokens: cacheWriteTokens,
    cache_read_tokens: cacheReadTokens,
    cost_usd: costUsd,
  });
  // Never let a logging failure fail the actual job — the content was already generated.
  if (error) console.error("usage_ledger insert failed:", error.message);
}

// Frozen, tenant-agnostic compliance rules — real money runs against real ad-review systems.
// See CLAUDE.md "Content rules" for the source of truth; keep these in sync.
export const COMPLIANCE_SYSTEM = `You are the content-generation engine for Affiliate Offer Secrets, a platform that helps affiliate marketers create promotional assets for ClickBank products they've chosen to promote. The assets you write go live on real paid ad platforms (Meta, TikTok) and public web pages — the rules below are not stylistic suggestions, they get real ad accounts banned and real pages penalized if violated.

Non-negotiable rules:
1. Every factual claim, benefit, or feature you write about the product must be traceable to the product context and sales-page excerpt you are given. Never invent results, income figures, cure claims, testimonials, or statistics that are not present in the source material. If the sales page could not be fetched, write conservatively using only the title/description/niche and do not invent specifics.
2. Health and wealth niches are heavily policed by Meta and TikTok ad review. Prefer curiosity and mechanism angles ("here's the surprising reason X happens") over guaranteed-outcome promise angles ("lose 20lbs guaranteed"). Never make personal-attribute callouts (e.g. directly addressing someone's body, finances, or health condition). If the product's own sales page makes claims that would get ads rejected, write conservatively rather than amplifying those claims.
3. Every bridge (landing) page and blog article must carry a clear, visible affiliate disclosure statement.
4. Write in a natural, editorial voice — avoid hypey ALL-CAPS, excessive emoji, or spammy formatting. This should read like credible content, not a scammy ad.
5. Stay strictly within the requested structure/field names for each task — the platform code parses specific fields out of your output, and extra commentary outside those fields will be discarded or break parsing.
6. You will always be given the product's title, niche, marketplace stats, and an extracted sales-page excerpt as grounding context. Base all copy on that material, not on general knowledge of the product category.`;


/**
 * Failures that cannot come out differently on a retry.
 *
 * `worker.ts` retries a failed job up to MAX_ATTEMPTS. That is right for a timeout, a 429, or a
 * transient 5xx — and pure waste for "Your credit balance is too low", which is exactly what an
 * exhausted account returns. Every attempt costs a claim, a stage re-run and a slot in the queue,
 * and none of them can succeed until a person tops up. One build here burned 73 attempts against a
 * dead key before this existed.
 *
 * Deliberately NARROWER than lib/generation/video.ts's isAccountLevelFailure, which answers a
 * different question. That one decides "should I fall back to the other provider", where a 429 is a
 * perfectly good reason to switch. This one decides "is retrying pointless", where a 429 is the
 * opposite — a rate limit clears on its own and the job should absolutely try again. Conflating the
 * two would turn every rate limit into a terminal failure.
 */
export function isPermanentAnthropicFailure(err: unknown): boolean {
  const anyErr = err as any;
  const type = anyErr?.error?.error?.type ?? anyErr?.error?.type;
  // authentication_error = bad/absent key; permission_error = key lacks access. Neither changes
  // without a person acting. rate_limit_error, api_error and overloaded_error are all excluded.
  if (type === "authentication_error" || type === "permission_error") return true;

  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("credit balance is too low") ||
    msg.includes("insufficient credit") ||
    msg.includes("billing") ||
    msg.includes("invalid x-api-key") ||
    msg.includes("anthropic_api_key is not set")
  );
}

/** Tag an error so worker.ts's failJob short-circuits the retry budget instead of burning it. */
function markPermanent<E>(err: E): E {
  if (isPermanentAnthropicFailure(err)) {
    (err as any).permanent = true;
    if (err instanceof Error && /credit balance is too low|insufficient credit/i.test(err.message)) {
      // Restated for the person who sees it in the UI. The raw API text says "go to Plans &
      // Billing" without saying whose, and the tenant seeing this notification cannot act on it —
      // the key belongs to the operator of this app.
      err.message =
        "Anthropic API credit is exhausted — the platform owner needs to top up before kits can build.";
    }
  }
  return err;
}

// Structured JSON output via a single forced tool call — the stable, well-documented way to get
// machine-parseable output from the Messages API across SDK versions.
export async function completeJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  toolName?: string;
  usage?: UsageContext;
}): Promise<T> {
  const toolName = opts.toolName ?? "emit_result";
  // getAnthropic() is INSIDE the try: an unset key throws, and that is the most permanent failure
  // of all — retrying it five times is the same waste as retrying an exhausted balance.
  let msg: Anthropic.Message;
  try {
    const anthropic = getAnthropic();
    msg = await anthropic.messages.create({
      model: ENGINE_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: toolName,
          description: "Emit the structured result for this task.",
          input_schema: opts.schema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: opts.prompt }],
    });
  } catch (err) {
    // Rethrown either way — the only thing added is the `permanent` flag worker.ts reads. A
    // transient error is left completely untouched so it retries exactly as it always did.
    throw markPermanent(err);
  }

  // Log real cost even on a refusal/malformed response — tokens were genuinely spent.
  if (opts.usage) await recordUsage(opts.usage, msg.model, msg.usage);

  if (msg.stop_reason === "refusal") {
    throw new Error("Model refused to generate this content");
  }

  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("Model did not return structured output");
  return repairDoubleEncoded(block.input) as T;
}

/**
 * Recovers a tool result whose values the model serialised to JSON *strings* instead of emitting
 * as structure.
 *
 * This is not hypothetical tidiness. Observed live against a real product: with a schema demanding
 * `fb_ad_angles: {type: "array", minItems: 3}`, the model returned
 *
 *   { "fb_ad_angles": "{\"fb_ad_angles\":[{...},{...},{...}]}" }
 *
 * — the whole object re-encoded as a string under its own key. The three angles were all there and
 * perfectly good; the stage still threw "Model did not return exactly 3 ad angles", which is both
 * wrong and unhelpful, and did so on all five attempts because the behaviour was deterministic for
 * that prompt. A build ended as a terminal error with nothing written.
 *
 * Both observed shapes are handled: a value that is the expected value re-encoded, and a value that
 * is the WHOLE object re-encoded under its own key.
 *
 * Deliberately conservative. A string is only replaced when it starts with `{`/`[` AND parses AND
 * yields an object or array — so a legitimate markdown field (email_md, tiktok_md, blog_md) is
 * untouched even when it opens with a markdown link. Anything that doesn't parse is left exactly
 * as it came back.
 */
export function repairDoubleEncoded(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;

  const obj = input as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      out[key] = value;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      out[key] = value; // Not JSON after all — a markdown link, say. Leave it alone.
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      out[key] = value; // Parsed to a bare number/bool/null; that was never the intent.
      continue;
    }
    // The whole object re-encoded under its own key — unwrap one level rather than nesting it.
    const unwrapped =
      !Array.isArray(parsed) && key in (parsed as Record<string, unknown>)
        ? (parsed as Record<string, unknown>)[key]
        : parsed;
    out[key] = unwrapped;
    changed = true;
  }

  return changed ? out : input;
}
