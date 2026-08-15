import { AlertTriangle } from "lucide-react";

/**
 * The "couldn't load" panel — the counterpart EmptyState must never be asked to play.
 *
 * Exists because of a real failure with a real cost: the Domains page's query broke (an ambiguous
 * PostgREST embed after migration 0088) and the page destructured `{ data }` while discarding the
 * error — so for a week-plus it rendered the ordinary "no domains yet" empty state over a live,
 * verified domain serving five funnels. The operator believed it, re-added the domain, and hit a
 * duplicate-claim dead end. An empty state is a CLAIM ABOUT THE DATA ("you have none"); a failed
 * query cannot support that claim, and rendering one anyway is how a bug hides as normalcy.
 *
 * Server pages use it per-query: check the error the destructure was throwing away, and render
 * this instead of handing the component an empty array. Deliberately no retry button — these are
 * server components, so reloading the page IS the retry, and the message says so.
 */
export default function LoadFailed({ what, detail }: { what: string; detail?: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
      <div className="text-sm">
        <p className="font-semibold text-amber-200">Couldn&apos;t load {what}</p>
        <p className="mt-1 text-zinc-400">
          This isn&apos;t an empty list — the data didn&apos;t load. Reload the page to try again; if it
          keeps failing, the error below is what support needs.
        </p>
        {detail ? <p className="mt-2 break-all font-mono text-xs text-zinc-500">{detail}</p> : null}
      </div>
    </div>
  );
}
