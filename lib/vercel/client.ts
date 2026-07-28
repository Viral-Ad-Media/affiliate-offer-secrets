// Thin wrapper over Vercel's REST Domains API — used to attach a client's bring-your-own domain
// to this Vercel project so their bridge pages can be served under it. Same shape as
// lib/meta/client.ts (typed fetch helpers + a dedicated error class).

const VERCEL_API_BASE = "https://api.vercel.com";

// Well-known Vercel targets a client points their own DNS at. Shown to the user as setup
// instructions — Vercel's add-domain response doesn't itself repeat these for the common case.
export const VERCEL_DNS_A_RECORD = "76.76.21.21";
export const VERCEL_DNS_CNAME_TARGET = "cname.vercel-dns.com";

export class VercelApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "VercelApiError";
    this.status = status;
  }
}

function getProjectId(): string {
  const id = process.env.VERCEL_PROJECT_ID;
  if (!id) throw new Error("VERCEL_PROJECT_ID is not set");
  return id;
}

function getApiToken(): string {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("VERCEL_API_TOKEN is not set");
  return token;
}

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID;
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${VERCEL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new VercelApiError(data?.error?.message ?? `Vercel API error (${res.status})`, res.status);
  }
  return data as T;
}

export type VerificationChallenge = {
  type: string;
  domain: string;
  value: string;
  reason: string;
};

export type AddDomainResult = {
  verified: boolean;
  verification: VerificationChallenge[];
};

// POST /v10/projects/{id}/domains — attaches the domain to this project. `verified: false` means
// Vercel needs an ownership-proof TXT record (only for domains already associated elsewhere on
// Vercel) — most fresh domains come back verified=true immediately, but still need real DNS
// (A/CNAME) pointed here before traffic actually resolves, checked separately via getDomainConfig.
export async function addDomainToProject(domain: string): Promise<AddDomainResult> {
  const data = await vercelFetch<{ verified?: boolean; verification?: VerificationChallenge[] }>(
    `/v10/projects/${getProjectId()}/domains${teamQuery()}`,
    { method: "POST", body: JSON.stringify({ name: domain }) }
  );
  return { verified: !!data.verified, verification: data.verification ?? [] };
}

export type DomainConfig = {
  misconfigured: boolean;
};

// GET /v6/domains/{domain}/config — the actual DNS-pointing check. `misconfigured: false` means
// the domain's A/CNAME records genuinely point at Vercel and traffic will route here.
export async function getDomainConfig(domain: string): Promise<DomainConfig> {
  const data = await vercelFetch<{ misconfigured?: boolean }>(
    `/v6/domains/${encodeURIComponent(domain)}/config${teamQuery()}`
  );
  return { misconfigured: data.misconfigured !== false };
}

export type ProjectDomain = {
  verified: boolean;
  verification: VerificationChallenge[];
};

// GET /v9/projects/{id}/domains/{domain} — current ownership-verification state.
export async function getProjectDomain(domain: string): Promise<ProjectDomain> {
  const data = await vercelFetch<{ verified?: boolean; verification?: VerificationChallenge[] }>(
    `/v9/projects/${getProjectId()}/domains/${encodeURIComponent(domain)}${teamQuery()}`
  );
  return { verified: !!data.verified, verification: data.verification ?? [] };
}

// POST /v9/projects/{id}/domains/{domain}/verify — re-attempts ownership verification (e.g.
// after the client adds the requested TXT record).
export async function verifyProjectDomain(domain: string): Promise<ProjectDomain> {
  const data = await vercelFetch<{ verified?: boolean; verification?: VerificationChallenge[] }>(
    `/v9/projects/${getProjectId()}/domains/${encodeURIComponent(domain)}/verify${teamQuery()}`,
    { method: "POST" }
  );
  return { verified: !!data.verified, verification: data.verification ?? [] };
}

// DELETE /v9/projects/{id}/domains/{domain} — detaches the domain from the project entirely.
export async function removeDomainFromProject(domain: string): Promise<void> {
  await vercelFetch(`/v9/projects/${getProjectId()}/domains/${encodeURIComponent(domain)}${teamQuery()}`, {
    method: "DELETE",
  });
}

// Combined check used both right after adding a domain and by the periodic re-verification cron:
// our own status='verified' should only ever mean BOTH ownership-verified AND DNS actually
// pointed here — either alone isn't enough for a domain to actually serve real traffic safely.
export async function isDomainFullyVerified(domain: string): Promise<boolean> {
  const [projectDomain, config] = await Promise.all([
    getProjectDomain(domain),
    getDomainConfig(domain).catch(() => ({ misconfigured: true })),
  ]);
  return projectDomain.verified && !config.misconfigured;
}
