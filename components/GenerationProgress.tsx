"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { generationProgress } from "@/lib/generationProgress";
import type { GenerationJobType } from "@/lib/generationStages";

/**
 * "Generating…" with a real percentage, for every image/video generation in the app.
 *
 * Every one of these surfaces already polls the ENTITY (a `campaign_creatives` row, a campaign's
 * `video_status`, a post's `featured_image_status`) — which only ever says none/generating/ready/
 * failed. That is enough to know something is happening and nothing about how far along it is, so
 * a Veo render looked identical at second 5 and minute 4. The stage lives on the `jobs` row, so
 * this component finds that row itself rather than every caller growing its own job query.
 *
 * Reads through the browser client against `jobs`' own workspace RLS — the same pattern
 * `CreativeItemCard`/`BroadcastActivateControl` already use for their entity reads. No new route:
 * this is one small row, and `/api/jobs` returns the whole queue.
 */
export default function GenerationProgress({
  jobType,
  matchKey,
  matchValue,
  className,
}: {
  jobType: GenerationJobType;
  /** The payload key that identifies this generation — e.g. "campaign_creative_id". */
  matchKey: string;
  matchValue: string;
  className?: string;
}) {
  const [stage, setStage] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function read() {
      const { data } = await supabase
        .from("jobs")
        .select("stage")
        .eq("type", jobType)
        .eq(`payload->>${matchKey}`, matchValue)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setStage((data as { stage: number | null } | null)?.stage ?? null);
    }

    read();
    // 4s matches the entity poll the parent is already running, so the number and the status it
    // sits beside can't disagree by more than one tick.
    const t = setInterval(read, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [jobType, matchKey, matchValue]);

  const p = generationProgress(jobType, stage);

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 text-xs text-sky-300">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="truncate">{p.label}…</span>
        <span className="ml-auto shrink-0 tabular-nums text-zinc-400">{p.percent}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-sky-400 transition-[width] duration-500"
          style={{ width: `${p.percent}%` }}
        />
      </div>
      {/* The bar genuinely does not move during the render — say so rather than let a still bar
          read as a stall. */}
      {p.slow && (
        <p className="mt-1 text-[11px] text-zinc-500">
          Waiting on the generator — this step can take a few minutes.
        </p>
      )}
    </div>
  );
}
