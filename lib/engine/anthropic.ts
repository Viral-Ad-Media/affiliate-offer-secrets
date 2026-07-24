import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export const ENGINE_MODEL = "claude-sonnet-5";

// Frozen, tenant-agnostic compliance rules — real money runs against real ad-review systems.
// See CLAUDE.md "Content rules" for the source of truth; keep these in sync.
export const COMPLIANCE_SYSTEM = `You are the content-generation engine for ClickBank Studio, a platform that helps affiliate marketers create promotional assets for ClickBank products they've chosen to promote. The assets you write go live on real paid ad platforms (Meta, TikTok) and public web pages — the rules below are not stylistic suggestions, they get real ad accounts banned and real pages penalized if violated.

Non-negotiable rules:
1. Every factual claim, benefit, or feature you write about the product must be traceable to the product context and sales-page excerpt you are given. Never invent results, income figures, cure claims, testimonials, or statistics that are not present in the source material. If the sales page could not be fetched, write conservatively using only the title/description/niche and do not invent specifics.
2. Health and wealth niches are heavily policed by Meta and TikTok ad review. Prefer curiosity and mechanism angles ("here's the surprising reason X happens") over guaranteed-outcome promise angles ("lose 20lbs guaranteed"). Never make personal-attribute callouts (e.g. directly addressing someone's body, finances, or health condition). If the product's own sales page makes claims that would get ads rejected, write conservatively rather than amplifying those claims.
3. Every presell page, bridge page, and blog article must carry a clear, visible affiliate disclosure statement.
4. Write in a natural, editorial voice — avoid hypey ALL-CAPS, excessive emoji, or spammy formatting. This should read like credible content, not a scammy ad.
5. Stay strictly within the requested structure/field names for each task — the platform code parses specific fields out of your output, and extra commentary outside those fields will be discarded or break parsing.
6. You will always be given the product's title, niche, marketplace stats, and an extracted sales-page excerpt as grounding context. Base all copy on that material, not on general knowledge of the product category.`;

// Structured JSON output via a single forced tool call — the stable, well-documented way to get
// machine-parseable output from the Messages API across SDK versions.
export async function completeJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  toolName?: string;
}): Promise<T> {
  const anthropic = getAnthropic();
  const toolName = opts.toolName ?? "emit_result";
  const msg = await anthropic.messages.create({
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

  if (msg.stop_reason === "refusal") {
    throw new Error("Model refused to generate this content");
  }

  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("Model did not return structured output");
  return block.input as T;
}
