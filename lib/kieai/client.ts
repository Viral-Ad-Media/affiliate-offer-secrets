// Thin wrapper over kie.ai's unified Jobs API (createTask/recordInfo) — used for ad-creative
// image generation. Verified live against kie.ai's docs: base https://api.kie.ai, Bearer auth,
// async task pattern (submit, then poll by taskId).

const KIE_AI_BASE = "https://api.kie.ai";

export class KieAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KieAiError";
  }
}

function getApiKey(): string {
  const key = process.env.KIE_AI_API_KEY;
  if (!key) throw new Error("KIE_AI_API_KEY is not set");
  return key;
}

export async function createKieTask(model: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${KIE_AI_BASE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new KieAiError(json.msg ?? `kie.ai createTask failed (${res.status})`);
  }
  const taskId = json.data?.taskId;
  if (!taskId) throw new KieAiError("kie.ai createTask returned no taskId");
  return taskId as string;
}

export type KieTaskStatus = {
  // kie.ai's exact `state` enum isn't fully documented publicly — matched case-insensitively
  // against "success"/"fail" substrings rather than an exact set, verify against a real
  // response during implementation and tighten this if the actual values differ.
  ready: boolean;
  succeeded: boolean;
  resultUrls: string[];
  failMsg: string | null;
};

export async function getKieTaskStatus(taskId: string): Promise<KieTaskStatus> {
  const res = await fetch(`${KIE_AI_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(12_000),
  });
  const json = await res.json();
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new KieAiError(json.msg ?? `kie.ai recordInfo failed (${res.status})`);
  }
  const state = String(json.data?.state ?? "").toLowerCase();
  const succeeded = state.includes("success");
  const failed = state.includes("fail");
  const resultJson = json.data?.resultJson ? JSON.parse(json.data.resultJson) : null;
  const resultUrls: string[] = resultJson?.resultUrls ?? resultJson?.urls ?? [];

  return {
    ready: succeeded || failed,
    succeeded,
    resultUrls,
    failMsg: failed ? (json.data?.failMsg ?? "kie.ai task failed") : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Veo video. A SECOND, separate surface from the Jobs API above — not a model slug on it.
//
// Probed live 2026-08-17 with a known-bad control, so the shapes below are measured rather than
// remembered: POST /api/v1/jobs/createTask answers 422 "The model name you specified is not
// supported" for `veo3` and `veo3_fast`, while POST /api/v1/veo/generate answers 422 "Please enter
// prompt" on an empty body — i.e. it exists and validates. Each field name below was then confirmed
// by its own distinct rejection ("Invalid model", "Ratio error") WITHOUT completing a generation,
// so pinning this contract cost zero credits.
// ---------------------------------------------------------------------------------------------

export type KieVeoParams = { prompt: string; model: string; aspectRatio: "16:9" | "9:16" };

export async function createKieVeoTask(params: KieVeoParams): Promise<string> {
  const res = await fetch(`${KIE_AI_BASE}/api/v1/veo/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new KieAiError(json.msg ?? `kie.ai veo/generate failed (${res.status})`);
  }
  const taskId = json.data?.taskId;
  if (!taskId) throw new KieAiError("kie.ai veo/generate returned no taskId");
  return taskId as string;
}

export type KieVeoStatus = { ready: boolean; succeeded: boolean; videoUrl: string | null; failMsg: string | null };

/**
 * GET, not POST — POST answers 404 "POST request not supported" (measured).
 *
 * The SUCCESS payload's exact shape is the one piece here not verified against a completed
 * generation, since confirming it costs a real render. It is therefore read defensively across the
 * documented shapes rather than one asserted path, and an unrecognised-but-finished response is
 * treated as a FAILURE rather than silently returning no URL — a video job that reports success
 * with nothing to download would strand the creative row in `generating` forever.
 */
export async function getKieVeoStatus(taskId: string): Promise<KieVeoStatus> {
  const res = await fetch(`${KIE_AI_BASE}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(12_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new KieAiError(json.msg ?? `kie.ai veo/record-info failed (${res.status})`);
  }
  const d = json.data ?? {};
  // successFlag: 0 generating, 1 success, 2/3 failed — plus a string `status` on some responses.
  const flag = d.successFlag;
  const status = String(d.status ?? "").toLowerCase();
  const failMsg: string | null = d.errorMessage ?? d.failMsg ?? null;

  const urls: string[] = d.response?.resultUrls ?? d.resultUrls ?? d.response?.urls ?? [];
  const videoUrl = Array.isArray(urls) && urls.length > 0 ? String(urls[0]) : null;

  const succeeded = flag === 1 || status.includes("success");
  const failed = flag === 2 || flag === 3 || status.includes("fail") || !!failMsg;
  if (succeeded && videoUrl) return { ready: true, succeeded: true, videoUrl, failMsg: null };
  if (succeeded && !videoUrl) {
    return { ready: true, succeeded: false, videoUrl: null, failMsg: "kie.ai reported success but returned no video URL" };
  }
  if (failed) return { ready: true, succeeded: false, videoUrl: null, failMsg: failMsg ?? "kie.ai video task failed" };
  return { ready: false, succeeded: false, videoUrl: null, failMsg: null };
}

/**
 * Remaining kie.ai credits. Measured: GET /api/v1/chat/credit -> {code:200, data:<number>}.
 *
 * Used to explain a fallback ("kie.ai has 3 credits left") rather than to gate one — the balance
 * needed for a given render isn't published, so refusing to try based on this number would invent
 * a limit the provider didn't state.
 */
export async function getKieCredit(): Promise<number | null> {
  try {
    const res = await fetch(`${KIE_AI_BASE}/api/v1/chat/credit`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    const n = Number(json?.data);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function downloadKieResult(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new KieAiError(`Failed to download kie.ai result (${res.status})`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType };
}
