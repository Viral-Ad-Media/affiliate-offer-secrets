"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2, Hourglass } from "lucide-react";
import type { Job } from "@/lib/shared";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

const STATUS_CHIP: Record<string, string> = {
  done: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  running: "border-sky-500/30 bg-sky-500/15 text-sky-300",
  error: "border-red-500/30 bg-red-500/15 text-red-300",
  pending: "border-amber-500/30 bg-amber-500/15 text-amber-300",
};

// The engine's work log. Lived on the Marketplace page until now, where it was noise on the page
// you actually discover products from — jobs process automatically within seconds, so this is
// something you consult when something looks stuck, not part of the normal loop.
//
// Self-contained (own fetch + poll) rather than taking rows as props: it's the only consumer on
// its page now, and Marketplace keeps its own /api/jobs call for the "Queued" row indicator.
export default function JobsQueue({ limit = 50 }: { limit?: number }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) setJobs(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function deleteJob(id: string) {
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete that job");
      return;
    }
    await load();
  }

  return (
    <section className="card">
      {/* No title here — the page above already has one; this row exists for the Refresh button. */}
      <div className="flex items-center justify-end border-b border-ink-700 px-4 py-2">
        <Button onClick={load} variant="outline" className="!py-1 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <ul className="divide-y divide-ink-800">
        {jobs.slice(0, limit).map((j) => {
          const payload = j.payload;
          return (
            <li key={j.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span className={`chip ${STATUS_CHIP[j.status] ?? STATUS_CHIP.pending}`}>
                  {j.status}
                </span>
                <span className="text-zinc-300">
                  {j.type === "discover_products"
                    ? `Discover: ${payload.niche}`
                    : // Older build_campaign payloads carry neither key; "Build campaign: undefined"
                      // reads like a bug, so fall back to the bare label.
                      ["Build campaign", payload.vendor_id ?? payload.product_id]
                        .filter(Boolean)
                        .join(": ")}
                </span>
                {j.result && j.status === "error" && (
                  <span className="text-xs text-red-400">{j.result}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span title={j.id}>#{j.id.slice(0, 8)}</span>
                <button
                  onClick={() => deleteJob(j.id)}
                  title="Delete job"
                  className="rounded p-1 text-zinc-500 hover:bg-ink-700 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
        {jobs.length === 0 && (
          <li className="flex flex-col items-center px-4 py-8 text-center">
            <Hourglass className="mb-2 h-6 w-6 text-zinc-600" />
            <p className="text-sm text-zinc-400">{loading ? "Loading…" : "No jobs yet"}</p>
            <p className="mt-1 text-xs text-zinc-600">
              Queued discovery and campaign jobs will show up here.
            </p>
          </li>
        )}
      </ul>
    </section>
  );
}
