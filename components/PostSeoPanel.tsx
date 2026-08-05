"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Link2, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { analyzePostSeo, scoreTone, type SeoInput } from "@/lib/blogSeo";

/**
 * SEO score, link counts, and the regenerate/revert pair, for one post.
 *
 * Scored live from what's in the editor, not from what's saved — the point is to react while
 * you're writing. It calls the same analyzePostSeo the rest of the app uses, so the number here
 * and the number anywhere else are the same number.
 *
 * The score is on-page hygiene, not a ranking prediction, and the panel says so. A number that
 * implies knowledge of a search engine it can't see would be worse than no number.
 */
export default function PostSeoPanel({
  postId,
  input,
  hasSnapshot,
  snapshotAt,
  onApplied,
}: {
  postId: string;
  input: SeoInput;
  hasSnapshot: boolean;
  snapshotAt: string | null;
  onApplied: () => void;
}) {
  const report = useMemo(() => analyzePostSeo(input), [input]);
  const [busy, setBusy] = useState<"regenerate" | "revert" | null>(null);
  const [instruction, setInstruction] = useState("");
  const [showLinks, setShowLinks] = useState(false);

  const tone = scoreTone(report.score);
  const toneClass =
    tone === "good" ? "text-emerald-300" : tone === "ok" ? "text-amber-300" : "text-red-300";
  const ringClass =
    tone === "good" ? "border-emerald-500/40" : tone === "ok" ? "border-amber-500/40" : "border-red-500/40";

  async function run(kind: "regenerate" | "revert") {
    setBusy(kind);
    try {
      const res = await fetch(`/api/blog/posts/${postId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "regenerate" ? { instruction } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Something went wrong");
        return;
      }
      toast.success(kind === "regenerate" ? "Post rewritten" : "Previous version restored");
      setInstruction("");
      onApplied();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">SEO</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            On-page checks only — nothing here can see a search engine, so this is hygiene, not a
            ranking prediction.
          </p>
        </div>
        <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 ${ringClass}`}>
          <span className={`text-lg font-bold leading-none ${toneClass}`}>{report.score}</span>
          <span className="text-[9px] uppercase tracking-wide text-zinc-500">score</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Words" value={report.wordCount} />
        <Stat label="Internal links" value={report.internalLinks} />
        <Stat label="External links" value={report.externalLinks} />
      </div>

      {report.links.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLinks((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <Link2 className="h-3.5 w-3.5" />
            {showLinks ? "Hide" : "Show"} {report.links.length} link
            {report.links.length === 1 ? "" : "s"}
          </button>
          {showLinks && (
            <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
              {report.links.map((l, i) => (
                <li key={`${l.href}-${i}`} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    className={`shrink-0 rounded px-1 py-px text-[9px] uppercase ${
                      l.internal ? "bg-sky-500/15 text-sky-300" : "bg-zinc-500/15 text-zinc-400"
                    }`}
                  >
                    {l.internal ? "int" : "ext"}
                  </span>
                  <span className="truncate text-zinc-400" title={l.href}>
                    {l.href}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="space-y-1.5">
        {report.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-xs">
            {c.status === "pass" ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : c.status === "warn" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            )}
            <span className="min-w-0">
              <span className="text-zinc-300">{c.label}</span>
              <span className="block text-[11px] leading-snug text-zinc-500">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="space-y-2 border-t border-ink-700 pt-3">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={400}
          placeholder="Optional: what to change (e.g. more detail on pricing)"
          className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none placeholder:text-zinc-600 focus:border-emerald-500"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => run("regenerate")} disabled={busy !== null} className="btn-primary text-xs">
            {busy === "regenerate" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Regenerate
          </button>
          <button
            onClick={() => run("revert")}
            disabled={busy !== null || !hasSnapshot}
            title={hasSnapshot ? undefined : "Nothing to revert to yet"}
            className="btn-ghost text-xs"
          >
            {busy === "revert" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Revert
          </button>
        </div>
        {/* One snapshot, not a history — saying so beats letting someone assume otherwise and lose
            the original to a second regeneration. */}
        <p className="text-[11px] text-zinc-600">
          {hasSnapshot
            ? `Revert restores the version from ${snapshotAt ? new Date(snapshotAt).toLocaleString() : "before the last rewrite"}. Only the last one is kept — regenerating twice replaces it.`
            : "Regenerating saves the current version first, so you can undo it."}
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 px-2 py-1.5">
      <div className="text-sm font-semibold tabular-nums text-zinc-200">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}
