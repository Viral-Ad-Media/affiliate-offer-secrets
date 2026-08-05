"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Check, Loader2, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildSteps, buildPercent, type BuildStep } from "@/lib/buildProgress";
import type { Job } from "@/lib/shared";

/**
 * Live checklist for queued campaign builds.
 *
 * "Queued" was technically true and told you nothing — a kit takes minutes and moves through six
 * distinct pieces of work, and a button that says nothing for four of them reads as broken.
 *
 * Explicitly closeable, and it says so. The build is a server-side job; nothing about it depends
 * on this dialog being open, and a modal that implies otherwise would trap someone at their desk
 * watching a spinner. The notification it promises is real — lib/engine/worker.ts calls notify()
 * on completion, which is what the bell in the top bar reads.
 */
export default function BuildProgressDialog({
  open,
  onOpenChange,
  jobIds,
  titleByJobId,
  onAllDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The jobs this run queued — tracked by id so an unrelated build isn't shown as yours. */
  jobIds: string[];
  titleByJobId: Record<string, string>;
  onAllDone?: () => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (jobIds.length === 0) return;
    try {
      const all: Job[] = await fetch("/api/jobs").then((r) => r.json());
      setJobs(all.filter((j) => jobIds.includes(j.id)));
      setLoaded(true);
    } catch {
      // A failed poll is not worth a message — the next tick is 2s away, and the build is
      // unaffected either way.
    }
  }, [jobIds]);

  useEffect(() => {
    if (!open) return;
    load();
    // Faster than the 5s list poll: this is the one screen where a person is watching a stage
    // change, and a 5s gap reads as a stall.
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [open, load]);

  const settled = jobs.length > 0 && jobs.every((j) => j.status === "done" || j.status === "error");
  useEffect(() => {
    if (settled) onAllDone?.();
  }, [settled, onAllDone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {jobIds.length > 1 ? `Building ${jobIds.length} campaign kits` : "Building your campaign kit"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!loaded && (
            <p className="flex items-center gap-2 py-4 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting…
            </p>
          )}

          {jobs.map((job) => {
            const steps = buildSteps(job as any);
            const pct = buildPercent(steps);
            const errored = job.status === "error";
            return (
              <div key={job.id} className="rounded-lg border border-ink-700 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-zinc-200">
                    {titleByJobId[job.id] ?? "Campaign kit"}
                  </span>
                  <span className={`shrink-0 text-xs ${errored ? "text-red-300" : "text-zinc-500"}`}>
                    {errored ? "Failed" : job.status === "done" ? "Done" : `${pct}%`}
                  </span>
                </div>

                <div className="mb-2.5 h-1 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className={`h-full transition-all duration-500 ${errored ? "bg-red-500/60" : "bg-emerald-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <ul className="space-y-1">
                  {steps.map((s) => (
                    <StepRow key={s.key} step={s} errored={errored} />
                  ))}
                </ul>

                {errored && job.result && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="min-w-0">{job.result}</span>
                  </p>
                )}
              </div>
            );
          })}

          <div className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2.5">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-xs text-zinc-400">
              You can close this — the build keeps running on our side, and you&apos;ll get a
              notification when it&apos;s finished. Nothing here needs you to wait.
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={() => onOpenChange(false)} className="btn-ghost text-sm">
              {settled ? "Close" : "Close and let it run"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ step, errored }: { step: BuildStep; errored: boolean }) {
  const icon =
    step.state === "done" ? (
      <Check className="h-3.5 w-3.5 text-emerald-400" />
    ) : step.state === "active" ? (
      <Loader2 className={`h-3.5 w-3.5 ${errored ? "text-red-400" : "animate-spin text-emerald-400"}`} />
    ) : step.state === "skipped" ? (
      <Minus className="h-3.5 w-3.5 text-zinc-600" />
    ) : (
      <span className="block h-3.5 w-3.5 rounded-full border border-ink-600" />
    );

  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0">
        <span
          className={`block text-xs ${
            step.state === "done"
              ? "text-zinc-300"
              : step.state === "active"
                ? "text-zinc-100"
                : step.state === "skipped"
                  ? "text-zinc-600"
                  : "text-zinc-500"
          }`}
        >
          {/* The strike goes on the label alone. `line-through` on the row would drag the
              "not selected" note through with it — text-decoration inherits and no-underline
              doesn't cancel it (seen in the browser, not in review). */}
          <span className={step.state === "skipped" ? "line-through" : undefined}>{step.label}</span>
          {step.state === "skipped" && <span className="ml-1">not selected</span>}
        </span>
        {step.state === "active" && (
          <span className="block text-[11px] text-zinc-500">{step.detail}</span>
        )}
      </span>
    </li>
  );
}
