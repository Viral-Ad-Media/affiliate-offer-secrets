import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import MailProvidersPanel, { type MailProvidersStatus } from "@/components/MailProvidersPanel";
import ConnectionsPanel from "@/components/ConnectionsPanel";
import TikTokPanel from "@/components/TikTokPanel";
import NetworkConnectionsPanel from "@/components/NetworkConnectionsPanel";
import GenerationModelsPanel from "@/components/GenerationModelsPanel";
import SmsConnectionPanel, { type SmsStatus } from "@/components/SmsConnectionPanel";
import { getWorkspaceGenerationDefaults } from "@/lib/generationSettings";

const PROVIDER_LABELS: Record<string, string> = {
  meta: "Facebook",
  tiktok: "TikTok",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: { meta?: string; tiktok?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Host-resolved, so the panel shows the workspace whose subdomain you are actually on --
  // not whichever workspace profiles.active_workspace_id happens to hold in another tab.
  const ws = await currentWorkspaceId();

  const [metaStatus, tiktokStatus, mailProviders, networkRows, genDefaults, smsStatus] = await Promise.all([
    supabase
      .rpc("get_meta_connection_status", { p_workspace_id: ws })
      .then((r) => r.data ?? { connected: false }),
    supabase
      .rpc("get_tiktok_connection_status", { p_workspace_id: ws })
      .then((r) => r.data ?? { connected: false }),
    supabase
      .rpc("get_mail_provider_connections", { p_workspace_id: ws })
      .then((r) => (r.data ?? { active_provider: null, providers: [] }) as MailProvidersStatus),
    supabase
      .from("network_connections")
      .select("network, affiliate_id")
      .then((r) => r.data ?? []),
    getWorkspaceGenerationDefaults(supabase, ws!),
    supabase
      .rpc("get_sms_connection_status", { p_workspace_id: ws })
      .then((r) => (r.data ?? { connected: false }) as SmsStatus),
  ]);
  const networkConnections = Object.fromEntries(networkRows.map((r) => [r.network, r.affiliate_id]));

  const banners = (["meta", "tiktok"] as const)
    .map((key) => ({ key, value: searchParams[key] }))
    .filter((b) => b.value);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Integrations</h1>
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
        ) : value === "not_configured" ? (
          <div
            key={key}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
          >
            <span className="font-medium">{PROVIDER_LABELS[key]} isn&apos;t configured on this
            deployment.</span>{" "}
            Set{" "}
            <code className="text-amber-200">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="text-amber-200">GOOGLE_CLIENT_SECRET</code>, then redeploy.
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

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Affiliate networks
        </h2>
        <NetworkConnectionsPanel userId={user.id} workspaceId={ws!} initialConnections={networkConnections} />
      </div>


      <ConnectionsPanel status={metaStatus} workspaceId={ws!} />

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">TikTok</h2>
        <TikTokPanel status={tiktokStatus} />
      </div>

      {/* Transport lives here with the other connections — an API key or an SMTP host is the same
          kind of thing as a Facebook token. Sender IDENTITY (reply-to, business name, the postal
          address the footer needs) is a marketing decision that outlives any one provider, so it
          lives on Emails → Settings instead. */}
      {/* AI generation providers sit with the other connections: choosing which model spends your
          kie.ai / Google credit is the same class of decision as which mail provider sends. */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">AI generation</h2>
        <GenerationModelsPanel
          initialImage={genDefaults.image}
          initialVideo={genDefaults.video}
        />
      </div>

      {/* SMS sits beside Email: both are outbound messaging with per-tenant credentials, and both
          carry a consent obligation the app has to respect. */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">SMS</h2>
        <SmsConnectionPanel status={smsStatus} />
      </div>

      <div className="space-y-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Email</h2>
        <MailProvidersPanel status={mailProviders} />
        <p className="text-xs text-zinc-500">
          Reply-to address and the business details shown in your email footer are on{" "}
          <Link href="/emails/settings" className="underline hover:text-zinc-300">
            Emails → Settings
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
