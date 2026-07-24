import { redirect } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import ConnectionsPanel from "@/components/ConnectionsPanel";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: { meta?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: status } = await supabase.rpc("get_meta_connection_status");

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Connections</h1>
        <p className="text-sm text-zinc-400">
          Connect your Facebook Page to publish generated captions directly.
        </p>
      </header>

      {searchParams.meta === "connected" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Facebook connected.
        </div>
      )}
      {searchParams.meta === "cancelled" && (
        <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-300">
          Connection cancelled.
        </div>
      )}
      {searchParams.meta === "error" && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <XCircle className="h-4 w-4" /> Something went wrong connecting to Facebook. Try again.
        </div>
      )}

      <ConnectionsPanel status={status ?? { connected: false }} />
    </main>
  );
}
