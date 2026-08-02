// Direct integration with Google's Gemini API for Veo video generation — no third-party proxy.
// A plain platform-level API key, not a per-tenant OAuth client (there is no longer any Google
// OAuth in this codebase — Gmail sending and then YouTube were both retired): this is a
// plain API-key integration, same trust tier as ANTHROPIC_API_KEY. Verified live against
// Google's docs: base https://generativelanguage.googleapis.com/v1beta, x-goog-api-key auth,
// long-running-operation pattern (submit, then poll the returned operation name).

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const VEO_MODEL = "veo-3.1-generate-preview";

export class GeminiApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiApiError";
  }
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

export type VeoGenerateParams = {
  prompt: string;
  aspectRatio?: "16:9" | "9:16";
  durationSeconds?: 4 | 6 | 8;
  resolution?: "720p" | "1080p";
};

// Returns the operation name (e.g. "models/veo-3.1-generate-preview/operations/xyz") — persist
// this verbatim, it's the only handle to poll or resume tracking this generation.
export async function startVeoGeneration(params: VeoGenerateParams): Promise<string> {
  const res = await fetch(`${GEMINI_API_BASE}/models/${VEO_MODEL}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": getApiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: params.prompt }],
      parameters: {
        aspectRatio: params.aspectRatio ?? "9:16",
        durationSeconds: params.durationSeconds ?? 8,
        resolution: params.resolution ?? "720p",
        personGeneration: "allow_all",
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new GeminiApiError(json.error?.message ?? `Veo generation request failed (${res.status})`);
  }
  if (!json.name) throw new GeminiApiError("Veo generation returned no operation name");
  return json.name as string;
}

export type VeoOperationResult =
  | { done: false }
  | { done: true; videoUri: string; filtered: false }
  | { done: true; videoUri: null; filtered: true };

// A single, bounded status check — never loops/sleeps internally. Callers must treat `done:
// false` as "not ready yet, try again on a later invocation," never block waiting for it here.
export async function getVeoOperation(
  operationName: string,
  timeoutMs = 12_000
): Promise<VeoOperationResult> {
  const res = await fetch(`${GEMINI_API_BASE}/${operationName}`, {
    headers: { "x-goog-api-key": getApiKey() },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new GeminiApiError(json.error?.message ?? `Veo operation check failed (${res.status})`);
  }
  if (!json.done) return { done: false };

  const sample = json.response?.generateVideoResponse?.generatedSamples?.[0];
  const videoUri = sample?.video?.uri as string | undefined;
  if (!videoUri) return { done: true, videoUri: null, filtered: true };
  return { done: true, videoUri, filtered: false };
}

// The video URI Google returns is not a public link — it still requires the API key to fetch,
// and per Google's own docs shouldn't be treated as a durable long-term reference, so download
// immediately and persist elsewhere (Supabase Storage) rather than storing this URI.
export async function downloadVeoVideo(videoUri: string): Promise<Buffer> {
  const res = await fetch(videoUri, {
    headers: { "x-goog-api-key": getApiKey() },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new GeminiApiError(`Failed to download generated video (${res.status})`);
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("video/")) {
    throw new GeminiApiError(`Unexpected content-type for generated video: ${contentType}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
