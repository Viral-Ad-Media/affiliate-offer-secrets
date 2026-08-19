"use client";

import { useState } from "react";
import { marked } from "marked";
import type { FbAdAngle } from "@/lib/shared";
import CreativeItemCard from "./CreativeItemCard";
import LaunchAd from "./LaunchAd";
import { Badge } from "@/components/ui/badge";
import AdPreview from "./AdPreview";
import AdCompliancePanel from "./AdCompliancePanel";

// Structured card-per-angle view, replacing the old single marked.parse() blob for fb_ads_md.
// Falls back to that exact old render for campaigns built before fb_ad_angles existed — same
// "regenerate to upgrade" precedent PageEditor.tsx already established for page_copy = null. Each
// angle also gets its own LaunchAd (Phase J) — real ad launches now pick a specific angle and its
// own generated creative, replacing the old single campaign-level launch UI. Legacy campaigns
// (angles = null) can't launch per-angle ads until regenerated — same upgrade path as everything
// else gated on fb_ad_angles.
export default function AdAnglesPanel({
  campaignId,
  angles,
  legacyMarkdown,
  bridgePublished,
  previewImageUrl,
}: {
  campaignId: string;
  angles: FbAdAngle[] | null;
  legacyMarkdown: string | null;
  bridgePublished: boolean;
  /** The campaign's hero image, so the feed mock isn't an empty grey box. */
  previewImageUrl?: string | null;
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
        <AngleCard
          key={i}
          campaignId={campaignId}
          angle={angle}
          index={i}
          bridgePublished={bridgePublished}
          previewImageUrl={previewImageUrl}
        />
      ))}
    </div>
  );
}

/**
 * One angle's card. Module scope (never inline in AdAnglesPanel's body — a fresh identity per
 * render would remount every child on each poll tick) and stateful for one reason: the feed mock
 * must show this angle's OWN generated creative once it exists. CreativeItemCard is the component
 * that knows when that happens — it polls the campaign_creatives row — so it reports the ready
 * image up and the mock prefers it over the campaign hero. This is exactly the resolution order
 * the real launch uses (lib/engine/adlaunch.ts's thumbnail chain: angle's creative, then the
 * campaign-level image, then the vendor photo), so the preview shows what would actually run.
 */
function AngleCard({
  campaignId,
  angle,
  index,
  bridgePublished,
  previewImageUrl,
}: {
  campaignId: string;
  angle: FbAdAngle;
  index: number;
  bridgePublished: boolean;
  previewImageUrl?: string | null;
}) {
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-ink-700 p-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Angle {index + 1}
      </div>
      <div className="text-sm font-semibold text-zinc-100">{angle.headline}</div>
      <p className="mt-1 text-sm text-zinc-300">{angle.primary_text}</p>
      <p className="mt-1 text-xs text-zinc-500">{angle.description}</p>
      <Badge className="mt-2 inline-block !py-0.5 text-[12px]">{angle.cta}</Badge>

      {/* Preview and checks sit ABOVE the creative and launch controls, in the order the
          decision is actually made: see how it reads, see what might be refused, then spend. */}
      <AdPreview
        headline={angle.headline}
        primaryText={angle.primary_text}
        description={angle.description}
        cta={angle.cta}
        imageUrl={generatedUrl ?? previewImageUrl}
      />
      <AdCompliancePanel angle={angle} destinationPublished={bridgePublished} />

      <CreativeItemCard
        campaignId={campaignId}
        source="fb_ad_angle"
        itemIndex={index}
        onImageChange={setGeneratedUrl}
      />
      <LaunchAd
        campaignId={campaignId}
        angleIndex={index}
        defaultHeadline={angle.headline}
        defaultPrimaryText={angle.primary_text}
        bridgePublished={bridgePublished}
      />
    </div>
  );
}
