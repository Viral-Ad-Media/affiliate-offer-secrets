"use client";

import { useState } from "react";
import { Target, Sparkles, Loader2, Copy, Check } from "lucide-react";
import type { FbAdAngle } from "@/lib/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

// The "scale the winner" surface: once cold angles are running, the next move is re-engaging the
// warm visitors who came but didn't buy. This generates retargeting-specific angles (seeded from
// the campaign's cold angles server-side, so claims stay traceable) and shows them ready to copy
// into a Meta retargeting campaign. Display + copy only — launching happens in the operator's own
// retargeting ad set, where the audience (site visitors, 180-day window) is defined.
export default function RetargetingAnglesPanel({
  campaignId,
  initialAngles,
  hasColdAngles,
}: {
  campaignId: string;
  initialAngles: FbAdAngle[] | null;
  hasColdAngles: boolean;
}) {
  const [angles, setAngles] = useState<FbAdAngle[] | null>(initialAngles);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/retargeting-angles`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Generation failed");
        return;
      }
      setAngles(data.retargeting_angles as FbAdAngle[]);
      toast.success("Retargeting angles ready");
    } catch {
      toast.error("Generation failed");
    } finally {
      setBusy(false);
    }
  }

  function copy(a: FbAdAngle, i: number) {
    const text = `Headline: ${a.headline}\n\n${a.primary_text}\n\n${a.description}\n\nCTA: ${a.cta}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Target className="h-4 w-4 text-emerald-400" /> Scale the winner — retargeting
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          Your best cold angle brings visitors; most don&apos;t buy on the first look. Retargeting
          re-engages the ones who came back — warm traffic that already knows the offer. These angles
          are written for that audience: they acknowledge the earlier visit and answer the objection
          that stopped the sale. Run them to a <span className="text-zinc-300">website-visitors</span>{" "}
          audience in Meta, separate from your cold campaign.
        </p>
        {!hasColdAngles ? (
          <p className="mt-3 rounded-lg bg-ink-800 p-3 text-xs text-zinc-400">
            Generate the campaign kit&apos;s ad angles first — retargeting angles build on them.
          </p>
        ) : (
          <Button onClick={generate} disabled={busy} className="mt-3 text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {angles ? "Regenerate retargeting angles" : "Generate retargeting angles"}
          </Button>
        )}
      </div>

      {angles && angles.length > 0 && (
        <div className="space-y-3">
          {angles.map((a, i) => (
            <div key={i} className="rounded-lg border border-ink-700 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Retargeting angle {i + 1}
                </span>
                <button
                  onClick={() => copy(a, i)}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                >
                  {copied === i ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied === i ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-sm font-semibold text-zinc-100">{a.headline}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{a.primary_text}</p>
              {a.description && <p className="mt-1 text-xs text-zinc-500">{a.description}</p>}
              <span className="mt-2 inline-block rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                {a.cta}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
