"use client";

import { marked } from "marked";
import { Music2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CreativeItemCard from "@/components/CreativeItemCard";

export type TiktokScript = { hook: string; script: string };

/**
 * TikTok scripts, one card each, with their own generated video.
 *
 * Mirrors AdAnglesPanel exactly — including the legacy fallback. `tiktok_md` was a single markdown
 * blob, so a script had no index and nothing to hang a creative on; campaign_creatives keys on
 * (campaign_id, source, item_index, kind). Structuring the scripts is what made per-item video
 * possible, and the creative machinery needed only a third `source` value.
 *
 * Campaigns built before that keep their blob and render it read-only with a note, rather than
 * being parsed into items. That is the same call SocialPostsPanel makes for social_md, and it
 * avoids repeating the email_md mistake, where a blob's shape turned out to vary between rows.
 */
export default function TiktokScriptsPanel({
  campaignId,
  scripts,
  legacyMarkdown,
}: {
  campaignId: string;
  scripts: TiktokScript[] | null;
  legacyMarkdown: string | null;
}) {
  if (!scripts?.length) {
    if (!legacyMarkdown?.trim()) {
      return (
        <Card className="p-6 text-center">
          <Music2 className="mx-auto h-6 w-6 text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-400">No TikTok scripts in this kit</p>
          <p className="mt-1 text-xs text-zinc-600">
            Tick <span className="text-zinc-400">TikTok scripts</span> when you build or regenerate.
          </p>
        </Card>
      );
    }
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-xs text-zinc-400">
          This kit was built before scripts were generated individually, so they&apos;re one document
          and can&apos;t each have their own video. Regenerate the kit to split them into cards with
          per-script video generation.
        </p>
        <Card className="prose-dark p-4" >
          <div dangerouslySetInnerHTML={{ __html: marked.parse(legacyMarkdown) as string }} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {scripts.map((s, i) => (
        <Card key={i} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Badge className="border-ink-600 bg-ink-800 text-zinc-400">Script {i + 1}</Badge>
          </div>

          {/* The hook is the whole ad on TikTok — the first line decides whether the rest is ever
              watched — so it gets its own weight rather than being the first line of a paragraph. */}
          <p className="mt-2 text-sm font-semibold text-zinc-100">{s.hook}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{s.script}</p>

          {/* 9:16 by construction — see creativevideo.ts, where only fb_ad_angle is Feed-shaped. */}
          <div className="mt-3 border-t border-ink-700 pt-3">
            <CreativeItemCard campaignId={campaignId} source="tiktok_script" itemIndex={i} />
          </div>
        </Card>
      ))}
    </div>
  );
}
