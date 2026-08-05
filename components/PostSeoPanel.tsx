"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Link2, X } from "lucide-react";
import { analyzePostSeo, scoreTone, type SeoInput } from "@/lib/blogSeo";
import { Card } from "@/components/ui/card";

/**
 * SEO score, link counts and on-page checks for one post. Analysis only — Regenerate/Undo/Redo
 * live in the editor's top bar (components/PostRevisionControls.tsx), beside the other actions
 * that change the whole post. Rewriting an article isn't something you go looking for under a
 * score, and keeping it in both places would be two ways to fire the same expensive call.
 *
 * Scored live from what's in the editor, not from what's saved — the point is to react while
 * you're writing. It calls the same analyzePostSeo the rest of the app uses, so the number here
 * and the number anywhere else are the same number.
 *
 * The score is on-page hygiene, not a ranking prediction, and the panel says so. A number that
 * implies knowledge of a search engine it can't see would be worse than no number.
 */
export default function PostSeoPanel({ input }: { input: SeoInput }) {
  const funnel = input.pageKind === "funnel";
  const report = useMemo(() => analyzePostSeo(input), [input]);
  const [showLinks, setShowLinks] = useState(false);

  const tone = scoreTone(report.score);
  const toneClass =
    tone === "good" ? "text-emerald-300" : tone === "ok" ? "text-amber-300" : "text-red-300";
  const ringClass =
    tone === "good" ? "border-emerald-500/40" : tone === "ok" ? "border-amber-500/40" : "border-red-500/40";

  return (
    <Card as="section" className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{funnel ? "Page check" : "SEO"}</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            {funnel
              ? // Said plainly because the alternative is a number that quietly implies Google is
                // looking at a page that is explicitly told not to look.
                "This page is noindex by design, so this isn't a ranking score — it's the share preview (what shows when the link is pasted anywhere) and plain readability."
              : "On-page checks only — nothing here can see a search engine, so this is hygiene, not a ranking prediction."}
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

    </Card>
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
