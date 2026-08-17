import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReadyItem = {
  /** Stable key — campaign id + item index. */
  key: string;
  /** The campaign this came from, for the heading line. */
  campaignTitle: string;
  /** The generated copy itself, truncated by the caller if it wants. */
  preview: string;
  /** Optional second line — an ad angle's CTA, a caption's channel. */
  meta?: string | null;
  /** Where this gets posted or launched from. */
  href: string;
};

/**
 * Generated-but-not-yet-shipped assets, shown above the history of what HAS shipped.
 *
 * Socials and Ads both read only what already went out — audit_events for posts, ad_launches for
 * ads — so a finished kit's captions and angles existed on the campaign and appeared on neither
 * page. You had to already know they were there and drill into a product's tabs to find them,
 * which is the opposite of what a sidebar section is for.
 *
 * Shared between both pages so the two can't drift into different vocabularies for the same state,
 * the same reason FunnelNodeCard is shared between the map and the split-test branch.
 *
 * Deliberately NOT an action surface: posting and launching stay where the creative and the copy
 * are in front of you, because both spend money or publish under the tenant's name. This says
 * "this exists and here's where to use it" — one job, done in one line each.
 */
export default function ReadyToShip({
  icon: Icon,
  title,
  blurb,
  items,
  actionLabel,
  emptyNote,
}: {
  icon: LucideIcon;
  title: string;
  blurb: string;
  items: ReadyItem[];
  actionLabel: string;
  /** Shown instead of the list when a kit has produced nothing yet. */
  emptyNote: string;
}) {
  return (
    <Card as="section" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Icon className="h-4 w-4 text-emerald-400" /> {title}
          {items.length > 0 ? (
            <Badge className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              {items.length}
            </Badge>
          ) : null}
        </h2>
        <p className="text-xs text-zinc-500">{blurb}</p>
      </header>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">{emptyNote}</p>
      ) : (
        <ul className="divide-y divide-ink-700">
          {items.map((it) => (
            <li key={it.key} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-zinc-400">{it.campaignTitle}</p>
                <p className="mt-0.5 line-clamp-2 text-sm text-zinc-200">{it.preview}</p>
                {it.meta ? <p className="mt-0.5 text-xs text-zinc-500">{it.meta}</p> : null}
              </div>
              <Link href={it.href} className={cn(buttonVariants({ variant: "outline" }), "text-xs")}>
                {actionLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
