"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonX, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  checkAdAngle,
  measureAdAngle,
  AD_POLICY_LINKS,
  META_HEADLINE_RECOMMENDED,
  META_PRIMARY_TEXT_RECOMMENDED,
  type AdAngleLike,
  type Severity,
} from "@/lib/adCompliance";

const STYLE: Record<Severity, { icon: typeof Info; className: string; label: string }> = {
  block: { icon: OctagonX, className: "text-red-300", label: "Blocks launch" },
  warn: { icon: AlertTriangle, className: "text-amber-300", label: "Rejection risk" },
  info: { icon: Info, className: "text-zinc-400", label: "How it reads" },
};

/**
 * Pre-flight checks for one ad angle, shown where the launch button is.
 *
 * The wording is careful on purpose. It never says an ad will be approved, because nothing local
 * can know that — Meta and TikTok review with classifiers and humans against policies that change
 * without notice. It says what is likely to be refused and why, so the operator can disagree with
 * a specific reason rather than trust or distrust a verdict.
 *
 * The clean state is rendered rather than hidden: "nothing flagged" is information, and an absent
 * panel would be indistinguishable from a panel that failed to run.
 */
export default function AdCompliancePanel({
  angle,
  hasCreative,
  destinationPublished,
}: {
  angle: AdAngleLike;
  hasCreative?: boolean;
  destinationPublished?: boolean;
}) {
  const findings = checkAdAngle(angle, { hasCreative, destinationPublished });
  const size = measureAdAngle(angle);

  return (
    <div className="mt-3 rounded-lg border border-ink-700 bg-ink-900/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pre-flight checks</h4>
        <div className="flex flex-wrap items-center gap-2">
          {AD_POLICY_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-emerald-300"
            >
              {l.label} <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      </div>

      {findings.length === 0 ? (
        <p className="mt-2 flex items-start gap-2 text-xs text-zinc-400">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
          Nothing flagged. These are heuristics, not an approval — the platform still reviews every ad.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {findings.map((f, i) => {
            const s = STYLE[f.severity];
            return (
              <li key={i} className="flex items-start gap-2">
                <s.icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.className)} aria-hidden />
                <div className="min-w-0">
                  <p className={cn("text-xs font-medium", s.className)}>
                    {f.title}
                    <span className="ml-1.5 font-normal text-zinc-600">· {s.label}</span>
                  </p>
                  {/* The reason, always — a checklist that only says "no" teaches nothing and gets
                      ignored the first time it is wrong. */}
                  <p className="text-[11px] leading-relaxed text-zinc-500">{f.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* Lengths are a measurement, not a warning — every generated angle exceeds them, so listing
          each one as a finding buried the ones that actually risk rejection. The preview above is
          where the consequence is visible. */}
      <p className="mt-2 border-t border-ink-800 pt-2 text-[11px] text-zinc-600">
        Headline{" "}
        <span className={size.headlineOver ? "text-amber-300" : "text-zinc-400"}>
          {size.headline}/{META_HEADLINE_RECOMMENDED}
        </span>{" "}
        · primary text{" "}
        <span className={size.primaryOver ? "text-amber-300" : "text-zinc-400"}>
          {size.primaryText}/{META_PRIMARY_TEXT_RECOMMENDED}
        </span>
        {(size.headlineOver || size.primaryOver) && " — the preview shows where it cuts."}
      </p>
    </div>
  );
}
