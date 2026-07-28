"use client";

import { marked } from "marked";
import type { FbAdAngle } from "@/lib/shared";
import CreativeItemCard from "./CreativeItemCard";

// Structured card-per-angle view, replacing the old single marked.parse() blob for fb_ads_md.
// Falls back to that exact old render for campaigns built before fb_ad_angles existed — same
// "regenerate to upgrade" precedent PageEditor.tsx already established for page_copy = null.
export default function AdAnglesPanel({
  campaignId,
  angles,
  legacyMarkdown,
}: {
  campaignId: string;
  angles: FbAdAngle[] | null;
  legacyMarkdown: string | null;
}) {
  if (!angles && legacyMarkdown) {
    return (
      <div>
        <p className="mb-2 rounded-lg bg-ink-800 p-3 text-xs text-zinc-400">
          This campaign was generated before per-angle creative generation existed. Regenerate the
          campaign kit to unlock image/video buttons for each angle.
        </p>
        <div className="prose-dark" dangerouslySetInnerHTML={{ __html: marked.parse(legacyMarkdown) as string }} />
      </div>
    );
  }

  if (!angles) {
    return <p className="py-6 text-center text-sm text-zinc-500">Not generated yet.</p>;
  }

  return (
    <div className="space-y-4">
      {angles.map((angle, i) => (
        <div key={i} className="rounded-lg border border-ink-700 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Angle {i + 1}
          </div>
          <div className="text-sm font-semibold text-zinc-100">{angle.headline}</div>
          <p className="mt-1 text-sm text-zinc-300">{angle.primary_text}</p>
          <p className="mt-1 text-xs text-zinc-500">{angle.description}</p>
          <span className="chip mt-2 inline-block !py-0.5 text-[11px]">{angle.cta}</span>
          <CreativeItemCard campaignId={campaignId} source="fb_ad_angle" itemIndex={i} />
        </div>
      ))}
    </div>
  );
}
