import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Shared pager for the app's list pages. Server-rendered links, not client state: the page number
// lives in the URL so a row you were looking at survives a refresh, a back button, and a shared
// link — and each page is a fresh RLS-scoped query rather than a growing client-side array.
export const PAGE_SIZE = 50;

// Clamps whatever arrived in ?page= to a real page number. A non-numeric or out-of-range value is
// page 1 rather than an error — a bad query string shouldn't be a dead end.
export function pageFromParam(raw: string | string[] | undefined, totalPages = Infinity): number {
  const n = Number.parseInt(Array.isArray(raw) ? raw[0] : (raw ?? "1"), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, totalPages));
}

// Postgrest's .range() is inclusive on both ends.
export function pageRange(page: number, size = PAGE_SIZE): [number, number] {
  const from = (page - 1) * size;
  return [from, from + size - 1];
}

export default function Pager({
  page,
  total,
  basePath,
  size = PAGE_SIZE,
  label = "items",
}: {
  page: number;
  /** Total row count, from a head:true count query — not the length of the current page. */
  total: number;
  basePath: string;
  size?: number;
  label?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (total === 0) return null;

  const first = (page - 1) * size + 1;
  const last = Math.min(page * size, total);
  const href = (p: number) => (p <= 1 ? basePath : `${basePath}?page=${p}`);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
      <span>
        {first}–{last} of {total} {label}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev" className="btn-ghost !py-1 text-xs">
              <ChevronLeft className="h-3.5 w-3.5" /> Newer
            </Link>
          ) : (
            <span className="btn-ghost !py-1 text-xs opacity-40">
              <ChevronLeft className="h-3.5 w-3.5" /> Newer
            </span>
          )}
          <span className="px-2">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={href(page + 1)} rel="next" className="btn-ghost !py-1 text-xs">
              Older <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="btn-ghost !py-1 text-xs opacity-40">
              Older <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
