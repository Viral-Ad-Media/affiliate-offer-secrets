"use client";

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
  const defaultContent = posts?.[0]?.caption ?? legacyMarkdown ?? "";

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
          <PostToFacebook campaignId={campaignId} defaultMessage={defaultContent} imageUrl={sourceImageUrl} />
          <PostToInstagram campaignId={campaignId} defaultCaption={defaultContent} hasImage={hasEmbeddedImage} />
        </div>
      )}
    </div>
  );
}
