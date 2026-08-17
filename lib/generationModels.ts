// Which models can generate an image or a video, and what to try when one won't.
//
// ISOMORPHIC — no SDKs, no node:*, no secrets. The settings page and the per-generation dropdowns
// import this, so it must never reach for a provider client. Same rule BUILD_CAMPAIGN_STAGES
// (lib/buildStages.ts) and the generation stage lists (lib/generationStages.ts) already follow:
// importing one of those from its engine module drags the Gemini/kie.ai clients into a client
// bundle, which `tsc --noEmit` passes and `next build` fails.
//
// Every value below was verified live against the providers' own APIs before being written here —
// no model id is from memory. kie.ai's two surfaces were probed with a known-bad control so the
// probe measured something: an unsupported model answers 422 "The model name you specified is not
// supported", while a real model with empty input answers 500 "This field is required".

export type MediaKind = "image" | "video";

/** Which API a model is reached through. The unit that runs out of credit, so also the unit that fallback moves between. */
export type GenerationProvider = "gemini" | "kieai";

export type GenerationModel = {
  /** Our stable id — stored in settings and job payloads. Never the provider's own string. */
  id: string;
  label: string;
  kind: MediaKind;
  provider: GenerationProvider;
  /** Exactly what the provider's API expects. Verified live; see the per-entry notes. */
  apiModel: string;
  /** Shown under the option in the picker. Say what it's for, not marketing copy. */
  blurb: string;
};

export const GENERATION_MODELS: readonly GenerationModel[] = [
  {
    id: "gemini-veo-3.1",
    label: "Veo 3.1 — Google direct",
    kind: "video",
    provider: "gemini",
    // generativelanguage.googleapis.com :predictLongRunning — unchanged from lib/gemini/client.ts.
    apiModel: "veo-3.1-generate-preview",
    blurb: "Highest quality. Billed to your Google AI Studio key, which is the one that hit its quota.",
  },
  {
    id: "kie-veo3",
    label: "Veo 3 — via kie.ai",
    kind: "video",
    provider: "kieai",
    // POST /api/v1/veo/generate, model: "veo3". Underscore forms only — "veo3-fast" is rejected.
    apiModel: "veo3",
    blurb: "The same Google Veo model resold by kie.ai, billed to your kie.ai credits instead.",
  },
  {
    id: "kie-veo3-fast",
    label: "Veo 3 Fast — via kie.ai",
    kind: "video",
    provider: "kieai",
    apiModel: "veo3_fast",
    blurb: "Faster and cheaper per clip than Veo 3, at some quality cost. Good for volume.",
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    kind: "image",
    provider: "kieai",
    // POST /api/v1/jobs/createTask, model: "nano-banana-2". Today's default for every image path.
    apiModel: "nano-banana-2",
    blurb: "Today's default for ad creative, blog and campaign images.",
  },
  {
    id: "nano-banana-2-lite",
    label: "Nano Banana 2 Lite",
    kind: "image",
    provider: "kieai",
    apiModel: "nano-banana-2-lite",
    blurb: "Faster and cheaper, capped at 1K. Fine for thumbnails and social crops.",
  },
] as const;

/** Unchanged from before models were selectable, so an account that never opens Settings behaves exactly as it did. */
export const DEFAULT_MODEL_BY_KIND: Record<MediaKind, string> = {
  video: "gemini-veo-3.1",
  image: "nano-banana-2",
};

export function modelsForKind(kind: MediaKind): GenerationModel[] {
  return GENERATION_MODELS.filter((m) => m.kind === kind);
}

export function modelById(id: unknown): GenerationModel | null {
  if (typeof id !== "string") return null;
  return GENERATION_MODELS.find((m) => m.id === id) ?? null;
}

/**
 * The model to use, from the most specific preference that names a real model.
 *
 * Candidates in priority order — typically [per-generation override, workspace default]. Anything
 * unrecognised is SKIPPED rather than rejected: a model retired between the job being queued and
 * run must degrade to the default, not fail the job. Same reasoning as indexLayout() clamping a
 * stored blog layout instead of trusting it.
 */
export function resolveModel(kind: MediaKind, ...candidates: unknown[]): GenerationModel {
  for (const c of candidates) {
    const m = modelById(c);
    if (m && m.kind === kind) return m;
  }
  return modelById(DEFAULT_MODEL_BY_KIND[kind]) ?? modelsForKind(kind)[0];
}

/**
 * What to try, in order, when a generation fails for a reason retrying won't fix.
 *
 * The chain is the preferred model followed by ONE model per OTHER provider — never a second model
 * on the same provider. That is the whole point: the failures this exists for are quota, billing
 * and auth, which are properties of the ACCOUNT, not the model. Falling back from Veo 3 to Veo 3
 * Fast on an exhausted kie.ai balance would just spend a second request to fail identically.
 *
 * Consequence worth stating plainly: images currently have NO fallback, because kie.ai is the only
 * image provider wired up — the chain is length 1 and an image failure stays a failure. Adding a
 * second image provider is what changes that, not a change here.
 */
export function fallbackChain(kind: MediaKind, preferredId?: unknown): GenerationModel[] {
  const preferred = resolveModel(kind, preferredId);
  const chain = [preferred];
  const seenProviders = new Set<GenerationProvider>([preferred.provider]);
  for (const m of modelsForKind(kind)) {
    if (seenProviders.has(m.provider)) continue;
    seenProviders.add(m.provider);
    chain.push(m);
  }
  return chain;
}
