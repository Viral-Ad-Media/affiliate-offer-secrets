import { TrendingUp, Users, Send, Rocket } from "lucide-react";

// A data-free analytics illustration (stat tiles + a lead-trend bar chart), same token discipline
// as FunnelBuilderMockup — no real numbers, no screenshot, inverts cleanly in light/dark.

const BARS = [30, 42, 38, 55, 48, 63, 71, 66, 82, 78, 91, 100];

function Tile({ icon: Icon, value, label }: { icon: typeof Users; value: string; label: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
      <div className="flex items-center gap-1.5 text-emerald-400">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-lg font-bold tabular-nums text-zinc-100">{value}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}

export default function AnalyticsMockup() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-emerald-500/10 blur-2xl"
      />
      <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950 p-4 shadow-2xl">
        <div className="grid grid-cols-2 gap-2.5">
          <Tile icon={Users} value="1,204" label="Leads captured" />
          <Tile icon={Rocket} value="6" label="Funnels live" />
          <Tile icon={Send} value="3,910" label="Emails sent" />
          <Tile icon={TrendingUp} value="24.8%" label="Opt-in rate" />
        </div>

        {/* lead-trend bar chart */}
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-900 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-300">Leads · last 30 days</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
              <TrendingUp className="h-3 w-3" /> +18%
            </span>
          </div>
          <div className="mt-3 flex h-16 items-end gap-1">
            {BARS.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm bg-gradient-to-t from-emerald-500/30 to-emerald-400/80"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
