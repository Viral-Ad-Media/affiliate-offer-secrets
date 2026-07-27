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

export async function downloadKieResult(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new KieAiError(`Failed to download kie.ai result (${res.status})`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType };
}
