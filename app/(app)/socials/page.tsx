import { redirect } from "next/navigation";
import Link from "next/link";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Share2, Facebook, Instagram, Music2, Youtube } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";

export const dynamic = "force-dynamic";

/**
 * Socials — everything this account has published organically, in one place.
 *
 * Reads the EXISTING `audit_events` view (0049) filtered to the posting platforms rather than
 * querying meta_posts/instagram_posts/tiktok_posts separately. That view is `security_invoker`, so
 * each underlying table's own RLS still applies, and it already solves the ordering problem a
 * hand-rolled union would reintroduce (created_at alone isn't unique across tables, and a
 * non-deterministic sort makes rows appear twice or not at all while paging).
 *
 * Read-only, same relationship /ads has to launching: posting happens on the campaign's Social tab
 * where the caption and its creative are actually in front of you.
 */

const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube"] as const;

const META: Record<string, { label: string; Icon: typeof Facebook; className: string }> = {
  facebook: { label: "Facebook", Icon: Facebook, className: "border-sky-500/40 text-sky-300" },
  instagram: { label: "Instagram", Icon: Instagram, className: "border-pink-500/40 text-pink-300" },
  tiktok: { label: "TikTok", Icon: Music2, className: "border-zinc-500/40 text-zinc-300" },
  youtube: { label: "YouTube", Icon: Youtube, className: "border-red-500/40 text-red-300" },
};

export default async function SocialsPage({
  searchParams,
}: {
  searchParams: { page?: string; platform?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();
  if (!ws) redirect("/login");

  // An unknown ?platform= is ignored rather than 404'ing — unlike the blog's category filter, this
  // one is a convenience over a fixed list, not an addressable resource.
  const active = PLATFORMS.includes(searchParams.platform as (typeof PLATFORMS)[number])
    ? (searchParams.platform as string)
    : null;

  const scoped = () => {
    const q = supabase
      .from("audit_events")
      .select("id, platform, created_at, campaign_id, summary, detail, external_id", {
        count: "exact",
      })
      .eq("workspace_id", ws);
    return active ? q.eq("platform", active) : q.in("platform", [...PLATFORMS]);
  };

  // Count first so the page can be clamped: PostgREST answers a range starting past the end with a
  // 416, not an empty list — reachable by sitting on page 2 while rows are deleted.
  const { count } = await scoped().limit(0);
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = pageFromParam(searchParams.page, totalPages);
  const [from, to] = pageRange(page, PAGE_SIZE);

  const { data } = total
    ? await scoped().order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)
    : { data: [] };

  const rows = (data ?? []) as {
    id: string;
    platform: string;
    created_at: string;
    campaign_id: string | null;
    summary: string | null;
    detail: string | null;
    external_id: string | null;
  }[];

  return (
    <main className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Share2 className="h-5 w-5 text-emerald-400" /> Socials
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every organic post published from this workspace. Posting itself runs from a campaign&apos;s
          Social tab.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <Link
          href="/socials"
          aria-current={!active ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "text-xs",
            !active && "border-emerald-500 text-emerald-300"
          )}
        >
          All
        </Link>
        {PLATFORMS.map((p) => {
          const m = META[p];
          return (
            <Link
              key={p}
              href={`/socials?platform=${p}`}
              aria-current={active === p ? "page" : undefined}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "text-xs",
                active === p && "border-emerald-500 text-emerald-300"
              )}
            >
              <m.Icon className="h-3.5 w-3.5" /> {m.label}
            </Link>
          );
        })}
      </div>

      <Card as="section" className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={Share2} title="Nothing posted yet">
            Generate a campaign kit, then publish a caption or a video from its Social tab. Anything
            you post shows up here.
            <Link href="/products" className={cn(buttonVariants({ variant: "outline" }), "mt-3 text-sm")}>
              Go to My Products
            </Link>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink-800">
            {rows.map((r) => {
              const m = META[r.platform] ?? {
                label: r.platform,
                Icon: Share2,
                className: "border-ink-600 text-zinc-400",
              };
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <Badge className={cn("mt-0.5 shrink-0 gap-1", m.className)}>
                    <m.Icon className="h-3 w-3" /> {m.label}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">{r.summary ?? "Post"}</div>
                    {r.detail && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{r.detail}</div>
                    )}
                  </div>
                  <time className="shrink-0 text-xs text-zinc-500" dateTime={r.created_at}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Pager
        page={page}
        total={total}
        basePath="/socials"
        label="posts"
        preserve={active ? { platform: active } : undefined}
      />
    </main>
  );
}
