import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReadyItem = {
  /** Stable key — campaign id + item index. */
  key: string;
  /** Groups the list. Items from one campaign belong together. */
  campaignTitle: string;
  /** The generated copy itself, truncated by the caller if it wants. */
  preview: string;
  /** Optional second line — an ad angle's CTA, a caption's position. */
  meta?: string | null;
  /** Where this gets posted or launched from. */
  href: string;
};

/** Groups stay in the order the caller supplied, which is newest campaign first. */
function groupByCampaign(items: ReadyItem[]): { title: string; href: string; items: ReadyItem[] }[] {
  const groups = new Map<string, { title: string; href: string; items: ReadyItem[] }>();
  for (const item of items) {
    const existing = groups.get(item.campaignTitle);
    if (existing) existing.items.push(item);
    else groups.set(item.campaignTitle, { title: item.campaignTitle, href: item.href, items: [item] });
  }
  return Array.from(groups.values());
}

/**
 * Generated-but-not-yet-shipped assets, grouped by the campaign they came from.
 *
 * Socials and Ads read only what already went out — audit_events for posts, ad_launches for ads —
 * so a finished kit's captions and angles appeared on neither page. Measured at the time: 65
 * captions across 13 campaigns and 40 unlaunched angles, none of them visible.
 *
 * GROUPED, because a flat list of 41 angles reads as 41 unrelated pieces of work when it is really
 * 14 campaigns with three each — and the decision an operator makes ("which offer do I push
 * today") is per campaign, not per angle. Each group is a <details>, so a long list collapses
 * without a line of JavaScript and nothing is hidden behind a "+N more" that would recreate the
 * invisible-work problem this component exists to solve.
 *
 * Deliberately NOT an action surface: posting and launching stay on the campaign page where the
 * copy and its generated creative are together, because both spend money or publish under the
 * tenant's name. Shared between both pages so the two can't drift into different vocabularies for
 * the same state.
 */
export default function ReadyToShip({
  icon: Icon,
  title,
  blurb,
  items,
  actionLabel,
  emptyNote,
  /** Groups beyond this many start collapsed — the top of the list stays scannable. */
  openGroups = 3,
}: {
  icon: LucideIcon;
  title: string;
  blurb: string;
  items: ReadyItem[];
  actionLabel: string;
  emptyNote: string;
  openGroups?: number;
}) {
  const groups = groupByCampaign(items);

  return (
    <Card as="section" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Icon className="h-4 w-4 text-emerald-400" /> {title}
          {items.length > 0 && (
            <Badge className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              {items.length} across {groups.length} {groups.length === 1 ? "campaign" : "campaigns"}
            </Badge>
          )}
        </h2>
        <p className="text-xs text-zinc-500">{blurb}</p>
      </header>

      {groups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">{emptyNote}</p>
      ) : (
        <ul className="divide-y divide-ink-700">
          {groups.map((group, gi) => (
            <li key={group.title}>
              <details open={gi < openGroups} className="group/details">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 hover:bg-ink-800/50">
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-zinc-600 transition-transform group-open/details:rotate-90"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                    {group.title}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">{group.items.length}</span>
                </summary>

                <ul className="border-t border-ink-800 bg-ink-900/40">
                  {group.items.map((it) => (
                    <li key={it.key} className="flex flex-wrap items-start gap-3 py-2.5 pl-10 pr-4">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm text-zinc-200">{it.preview}</p>
                        {it.meta ? <p className="mt-0.5 text-xs text-zinc-500">{it.meta}</p> : null}
                      </div>
                      <Link href={it.href} className={cn(buttonVariants({ variant: "outline" }), "text-xs")}>
                        {actionLabel}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
