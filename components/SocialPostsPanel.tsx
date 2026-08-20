"use client";

import { useState } from "react";
import { marked } from "marked";
import type { SocialPost } from "@/lib/shared";
import CreativeItemCard from "./CreativeItemCard";
import PostToFacebook from "./PostToFacebook";
import PostToInstagram from "./PostToInstagram";

// Structured card-per-post view, replacing the old single marked.parse() blob for social_md.
// Same legacy fallback shape as AdAnglesPanel.tsx. PostToFacebook/PostToInstagram are unchanged
// components — only their default-content prop changes (first generated caption instead of the
// old flat social_md string); wiring a specific post's own creative into the actual posting call
// is explicitly deferred, see the Phase I plan.
export default function SocialPostsPanel({
  campaignId,
  posts,
  legacyMarkdown,
  sourceImageUrl,
  hasEmbeddedImage,
}: {
  campaignId: string;
  posts: SocialPost[] | null;
  legacyMarkdown: string | null;
  sourceImageUrl: string | null;
  hasEmbeddedImage: boolean;
}) {
  // Which post to publish, driving both its caption AND its own generated creative (the route
  // reads campaign_creatives for this index; falls back to the campaign hero if none is ready).
  const [selectedIndex, setSelectedIndex] = useState(0);
  const defaultContent = posts?.[selectedIndex]?.caption ?? posts?.[0]?.caption ?? legacyMarkdown ?? "";

  return (
    <div className="space-y-4">
      {!posts && legacyMarkdown ? (
        <div>
          <p className="mb-2 rounded-lg bg-ink-800 p-3 text-xs text-zinc-400">
            This campaign was generated before per-post creative generation existed. Regenerate
            the campaign kit to unlock image/video buttons for each post.
          </p>
          <div className="prose-dark" dangerouslySetInnerHTML={{ __html: marked.parse(legacyMarkdown) as string }} />
        </div>
      ) : !posts ? (
        <p className="py-6 text-center text-sm text-zinc-500">Not generated yet.</p>
      ) : (
        posts.map((post, i) => (
          <div key={i} className="rounded-lg border border-ink-700 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Post {i + 1}
            </div>
            <p className="text-sm text-zinc-300">{post.caption}</p>
            <CreativeItemCard campaignId={campaignId} source="social_post" itemIndex={i} />
          </div>
        ))
      )}

      {(posts || legacyMarkdown) && (
        <div className="space-y-3">
          {posts && posts.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">
                Publish which post — with its own generated image
              </span>
              <select
                value={selectedIndex}
                onChange={(e) => setSelectedIndex(Number(e.target.value))}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-sm text-zinc-100"
              >
                {posts.map((p, i) => (
                  <option key={i} value={i}>
                    Post {i + 1}
                    {p.caption ? ` — ${p.caption.slice(0, 40)}${p.caption.length > 40 ? "…" : ""}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* key remounts on selection so the editable caption resets to the chosen post's. */}
          <PostToFacebook
            key={`fb-${selectedIndex}`}
            campaignId={campaignId}
            defaultMessage={defaultContent}
            imageUrl={sourceImageUrl}
            creativeSource={posts ? "social_post" : undefined}
            creativeIndex={posts ? selectedIndex : undefined}
          />
          <PostToInstagram
            key={`ig-${selectedIndex}`}
            campaignId={campaignId}
            defaultCaption={defaultContent}
            hasImage={hasEmbeddedImage}
            creativeSource={posts ? "social_post" : undefined}
            creativeIndex={posts ? selectedIndex : undefined}
          />
        </div>
      )}
    </div>
  );
}
