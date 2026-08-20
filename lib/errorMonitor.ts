import type { createAdminClient } from "@/lib/supabase/admin";
import { createAdminClient as makeAdmin } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Server-side production error monitoring. captureError() writes one row to `error_events` (0118)
// for the superadmin dashboard, best-effort — it must NEVER throw or block the operation it wraps,
// exactly like notify(). This is the self-contained floor (no external account); Sentry is layered
// on via maybeForwardToSentry() when a DSN and the SDK are present ("Both" — the decided approach).
//
// SERVER-ONLY: it reaches for the admin client. Do not import from a client component.

export type CaptureLevel = "error" | "warning";

export type CaptureOptions = {
  level?: CaptureLevel;
  context?: Record<string, unknown>;
  userId?: string | null;
  workspaceId?: string | null;
  // Pass an existing admin client to avoid constructing a second one inside a handler that has one.
  admin?: AdminClient;
};

// Group key: source + a message with the volatile parts masked, so "job <uuid> failed at stage 4"
// and "job <other-uuid> failed at stage 4" collapse into ONE group with a count rather than a wall
// of near-identical rows. A plain djb2 hash — no node:crypto, so this stays a lightweight import.
export function errorFingerprint(source: string, message: string): string {
  const norm = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>") // uuids
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 200);
  const s = `${source}|${norm}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err).slice(0, 1000);
  } catch {
    return String(err);
  }
}

/**
 * Record a server-side error. `source` is a stable dotted label ('engine.worker',
 * 'api.billing.webhook') — it drives grouping and reads as the origin in the dashboard, so keep it
 * stable and free of ids. NEVER pass secrets in `message`/`context`; this is superadmin-visible.
 */
export async function captureError(source: string, err: unknown, opts: CaptureOptions = {}): Promise<void> {
  const message = toMessage(err).slice(0, 1000);
  try {
    const admin = opts.admin ?? makeAdmin();
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : null;
    const { error } = await admin.from("error_events").insert({
      level: opts.level ?? "error",
      source,
      message,
      fingerprint: errorFingerprint(source, message),
      stack,
      context: opts.context ?? {},
      user_id: opts.userId ?? null,
      workspace_id: opts.workspaceId ?? null,
    });
    if (error) console.error("[errorMonitor] insert failed:", error.message);
  } catch (e) {
    // The whole point is to never make things worse than the error we're recording.
    console.error("[errorMonitor] capture threw:", (e as Error).message);
  }
  maybeForwardToSentry(source, err, opts);
}

// Sentry seam — deliberately a no-op until BOTH `SENTRY_DSN` is set AND `@sentry/node` is installed.
// Kept behind a dynamic import so the package is not a hard dependency today (the "later" half of
// the decision): to turn it on, `npm i @sentry/node`, set SENTRY_DSN, and fill in the body below.
// Structured now so wiring it later is a one-file change, not a hunt through every call site.
function maybeForwardToSentry(_source: string, _err: unknown, _opts: CaptureOptions): void {
  if (!process.env.SENTRY_DSN) return;
  // import("@sentry/node").then((Sentry) => Sentry.captureException(_err, { tags: { source: _source } }))
  //   .catch(() => {});
}
