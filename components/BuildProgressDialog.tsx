"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Check, Link2, Loader2, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildSteps, buildPercent, type BuildStep } from "@/lib/buildProgress";
import type { Job } from "@/lib/shared";
import { Button } from "@/components/ui/button";

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

  // Products whose kit actually built. Read off the job payload rather than threaded in as a prop:
  // every caller already queues per product and the payload is in the poll response anyway, so a
  // second parameter would only be a second thing to keep in step.
  const builtJobs = jobs.filter((j) => j.status === "done" && typeof j.payload?.product_id === "string");
  const builtProductIds = Array.from(new Set(builtJobs.map((j) => j.payload.product_id as string)));
  const jobIdByProductId: Record<string, string> = {};
  for (const j of builtJobs) jobIdByProductId[j.payload.product_id as string] = j.id;
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

          {/* The one thing a finished kit still needs from a person. This app does not build
              affiliate links (see affiliateLink in lib/engine/renderPages.ts), so every page, ad
              and email in a fresh kit points at nothing until the real link is pasted — and a
              funnel that looks finished and converts nothing is exactly the failure worth
              interrupting for. Shown only once the build settles, so it never competes with the
              progress it would be read over. */}
          {settled && builtProductIds.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="min-w-0 text-xs text-zinc-300">
                <p className="font-medium text-amber-200">Add your affiliate link</p>
                <p className="mt-0.5 leading-relaxed text-zinc-400">
                  We don&apos;t generate one — a guessed link can resolve, look tracked and credit
                  nobody. Paste the real link from your network and every page, ad and article in
                  this kit updates.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {builtProductIds.map((id) => (
                    <a
                      key={id}
                      href={`/product/${id}`}
                      className="text-emerald-300 hover:underline"
                    >
                      {titleByJobId[jobIdByProductId[id]] ?? "Open kit"} →
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2.5">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-xs text-zinc-400">
              You can close this — the build keeps running on our side, and you&apos;ll get a
              notification when it&apos;s finished. Nothing here needs you to wait.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)} variant="outline" className="text-sm">
              {settled ? "Close" : "Close and let it run"}
            </Button>
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
