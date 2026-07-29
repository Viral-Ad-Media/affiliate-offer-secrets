import { Facebook, Instagram, Music2, Youtube, Mail, Send, ExternalLink } from "lucide-react";
import type { AuditEntry, AuditPlatform } from "@/lib/shared";

const PLATFORM_META: Record<AuditPlatform, { label: string; icon: typeof Facebook; className: string }> = {
  facebook: { label: "Facebook", icon: Facebook, className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  instagram: { label: "Instagram", icon: Instagram, className: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300" },
  tiktok: { label: "TikTok", icon: Music2, className: "border-zinc-400/30 bg-zinc-400/10 text-zinc-200" },
  youtube: { label: "YouTube", icon: Youtube, className: "border-red-500/30 bg-red-500/10 text-red-300" },
  mail: { label: "Mail", icon: Mail, className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  broadcast: { label: "Broadcast", icon: Send, className: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
};

export default function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Posting activity</h2>
        <p className="text-xs text-zinc-500">
          Every real post, upload, or email this app has sent on your behalf, across every
          connected platform.
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-zinc-500">
          Nothing posted yet — connect a platform and publish something from a campaign to see it
          here.
        </p>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-ink-900">
              <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2">When</th>
                <th className="px-2 py-2">Platform</th>
                <th className="px-2 py-2">Campaign</th>
                <th className="px-2 py-2">Details</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const meta = PLATFORM_META[e.platform];
                return (
                  <tr key={`${e.platform}-${e.id}`} className="border-b border-ink-800">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-500">
                      {new Date(e.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${meta.className}`}
                      >
                        <meta.icon className="h-3 w-3" /> {meta.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-zinc-300">{e.campaign_title ?? "—"}</td>
                    <td className="px-2 py-2 text-zinc-400">
                      <div className="line-clamp-1 max-w-xs">{e.summary}</div>
                      {e.detail && <div className="text-xs text-zinc-600">{e.detail}</div>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {e.externalUrl && (
                        <a
                          href={e.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
