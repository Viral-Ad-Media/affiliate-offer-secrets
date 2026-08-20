import { Eye, MousePointerClick, Users, GripVertical } from "lucide-react";

// A self-contained, data-free mockup of the funnel builder — the product's most distinctive
// surface. Deliberately NOT a real screenshot: those carry live tenant data (product names, lead
// emails) and must never be published on the public marketing site. Built from the app's own
// tokens (ink/zinc/emerald), so it inverts correctly in light and dark like everything else here.
// No external assets, no scripts — it's part of the server-rendered page.

function StatChip({ icon: Icon, value, label }: { icon: typeof Eye; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-md bg-ink-950/60 px-1.5 py-0.5">
      <Icon className="h-2.5 w-2.5 text-emerald-400" />
      <span className="text-[9px] font-semibold tabular-nums text-zinc-200">{value}</span>
      <span className="hidden text-[8px] text-zinc-500 sm:inline">{label}</span>
    </div>
  );
}

// A miniature "page thumbnail" node, matching the real funnel map's card shape.
function PageNode({
  title,
  accent = false,
  views,
  clicks,
  optins,
}: {
  title: string;
  accent?: boolean;
  views?: string;
  clicks?: string;
  optins?: string;
}) {
  return (
    <div
      className={`group relative w-full rounded-lg border ${
        accent ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-ink-700 bg-ink-900"
      } p-2 shadow-sm`}
    >
      <div className="absolute right-1 top-1 text-zinc-600">
        <GripVertical className="h-3 w-3" />
      </div>
      <div className="text-[9px] font-semibold text-zinc-300">{title}</div>
      {/* fake page content */}
      <div className="mt-1.5 space-y-1">
        <div className="h-1 w-3/4 rounded-full bg-zinc-100/15" />
        <div className="h-1 w-full rounded-full bg-zinc-100/10" />
        <div className="h-1 w-5/6 rounded-full bg-zinc-100/10" />
        <div className={`mt-1.5 h-3 w-1/2 rounded ${accent ? "bg-emerald-500/70" : "bg-emerald-500/40"}`} />
      </div>
      {(views || clicks || optins) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {views && <StatChip icon={Eye} value={views} label="views" />}
          {clicks && <StatChip icon={MousePointerClick} value={clicks} label="clicks" />}
          {optins && <StatChip icon={Users} value={optins} label="opt-ins" />}
        </div>
      )}
    </div>
  );
}

export default function FunnelBuilderMockup() {
  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {/* soft brand wash behind the frame */}
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-emerald-500/10 blur-2xl"
      />
      <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950 shadow-2xl">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-900/80 px-3 py-2">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          </span>
          <div className="ml-2 flex-1 rounded-md border border-ink-700 bg-ink-950/70 px-2 py-1 text-[9px] text-zinc-500">
            affiliateoffersecrets.com/funnels
          </div>
        </div>

        <div className="flex">
          {/* mini sidebar rail */}
          <div className="hidden w-9 flex-col items-center gap-2 border-r border-ink-700 bg-ink-900/50 py-3 sm:flex">
            <div className="h-4 w-4 rounded-md bg-emerald-500/70" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-3.5 w-3.5 rounded bg-zinc-100/10" />
            ))}
          </div>

          {/* canvas: the funnel map */}
          <div className="flex-1 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:14px_14px] p-4">
            <div className="mx-auto max-w-[280px] space-y-0">
              {/* opt-in */}
              <PageNode title="Opt-in page" accent views="4,812" clicks="—" optins="1,204" />

              {/* connector */}
              <div className="mx-auto h-4 w-px bg-ink-600" />
              <div className="text-center text-[8px] font-medium uppercase tracking-wide text-emerald-400/80">
                Split test · 25% ahead
              </div>
              <div className="mx-auto h-3 w-px bg-ink-600" />

              {/* A/B branch */}
              <div className="flex gap-2">
                <PageNode title="Control" views="2,401" optins="581" />
                <PageNode title="Variant B" accent views="2,411" optins="623" />
              </div>

              {/* merge connector */}
              <div className="mx-auto h-4 w-px bg-ink-600" />

              {/* thank-you step */}
              <PageNode title="Thank-you · upsell" views="1,204" clicks="317" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
