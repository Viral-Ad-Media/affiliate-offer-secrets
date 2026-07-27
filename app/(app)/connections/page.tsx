import { redirect } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import ConnectionsPanel from "@/components/ConnectionsPanel";
import TikTokPanel from "@/components/TikTokPanel";
import YouTubePanel from "@/components/YouTubePanel";
import MailPanel from "@/components/MailPanel";

const PROVIDER_LABELS: Record<string, string> = {
  meta: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  mail: "Gmail",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: { meta?: string; tiktok?: string; youtube?: string; mail?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [metaStatus, tiktokStatus, youtubeStatus, mailStatus] = await Promise.all([
    supabase.rpc("get_meta_connection_status").then((r) => r.data ?? { connected: false }),
    supabase.rpc("get_tiktok_connection_status").then((r) => r.data ?? { connected: false }),
    supabase.rpc("get_youtube_connection_status").then((r) => r.data ?? { connected: false }),
    supabase.rpc("get_mail_connection_status").then((r) => r.data ?? { connected: false }),
  ]);

  const banners = (["meta", "tiktok", "youtube", "mail"] as const)
    .map((key) => ({ key, value: searchParams[key] }))
    .filter((b) => b.value);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Connections</h1>
        <p className="text-sm text-zinc-400">
          Connect your accounts to publish generated content directly.
        </p>
      </header>

      {banners.map(({ key, value }) =>
        value === "connected" ? (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
          >
            <CheckCircle2 className="h-4 w-4" /> {PROVIDER_LABELS[key]} connected.
          </div>
        ) : value === "cancelled" ? (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-300"
          >
            Connection cancelled.
          </div>
        ) : value === "error" ? (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            <XCircle className="h-4 w-4" /> Something went wrong connecting to{" "}
            {PROVIDER_LABELS[key]}. Try again.
          </div>
        ) : null
      )}

      <ConnectionsPanel status={metaStatus} />

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">TikTok</h2>
        <TikTokPanel status={tiktokStatus} />
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">YouTube</h2>
        <YouTubePanel status={youtubeStatus} />
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Email</h2>
        <MailPanel status={mailStatus} />
      </div>
    </main>
  );
}
