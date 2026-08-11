"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Facebook, Instagram, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Page = { page_id: string; page_name: string; is_active: boolean; status: string };
type AdAccount = { ad_account_id: string; ad_account_name: string; currency: string; is_active: boolean };
type IgAccount = { ig_user_id: string; ig_username: string; is_active: boolean };
type Status = {
  connected: boolean;
  status?: string;
  ads_management_granted?: boolean;
  pages?: Page[];
  ad_accounts?: AdAccount[];
  instagram_accounts?: IgAccount[];
};

export default function ConnectionsPanel({
  status,
  workspaceId,
}: {
  status: Status;
  workspaceId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setActivePage(pageId: string) {
    setBusy(pageId);
    await createClient().rpc("set_active_meta_page", {
      p_page_id: pageId,
      p_workspace_id: workspaceId,
    });
    router.refresh();
    setBusy(null);
  }

  async function setActiveAdAccount(adAccountId: string) {
    setBusy(adAccountId);
    await createClient().rpc("set_active_meta_ad_account", {
      p_ad_account_id: adAccountId,
      p_workspace_id: workspaceId,
    });
    router.refresh();
    setBusy(null);
  }

  async function disconnect() {
    setBusy("disconnect");
    await fetch("/api/meta/disconnect", { method: "POST" });
    router.refresh();
    setBusy(null);
  }

  if (!status.connected) {
    return (
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Connect Facebook</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Connect your Facebook Page to publish generated captions with one click.
        </p>
        <a href="/api/meta/connect" className={cn(buttonVariants(), "inline-flex w-fit")}>
          <Facebook className="h-4 w-4" /> Connect Facebook
        </a>
      </Card>
    );
  }

  const needsReconnect = status.status === "needs_reconnect";
  const pages = status.pages ?? [];
  const adAccounts = status.ad_accounts ?? [];
  const igAccounts = status.instagram_accounts ?? [];

  return (
    <div className="space-y-4">
      {needsReconnect && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Your Facebook connection needs to be renewed.{" "}
          <a href="/api/meta/connect" className="underline">
            Reconnect
          </a>
        </div>
      )}
      {!status.ads_management_granted && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Ad permissions weren&apos;t granted, so launching real ad campaigns isn&apos;t available
          yet.{" "}
          <a href="/api/meta/connect" className="underline">
            Reconnect to enable it
          </a>
        </div>
      )}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Connected Pages</h2>
          <Button
            onClick={disconnect}
            disabled={busy === "disconnect"} variant="outline" className="!py-1 text-xs">
            Disconnect
          </Button>
        </div>
        <ul className="space-y-2">
          {pages.map((p) => (
            <li
              key={p.page_id}
              className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2.5"
            >
              <div>
                <div className="text-sm text-zinc-100">{p.page_name}</div>
                {p.status === "needs_reconnect" && (
                  <div className="text-xs text-amber-400">Needs reconnect</div>
                )}
              </div>
              {p.is_active ? (
                <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Active
                </Badge>
              ) : (
                <Button
                  onClick={() => setActivePage(p.page_id)}
                  disabled={busy === p.page_id} variant="outline" className="!py-1 text-xs">
                  {busy === p.page_id ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Set active"
                  )}
                </Button>
              )}
            </li>
          ))}
          {pages.length === 0 && (
            <li className="text-sm text-zinc-500">No Pages found for this Facebook account.</li>
          )}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Instagram Accounts</h2>
        <ul className="space-y-2">
          {igAccounts.map((a) => (
            <li
              key={a.ig_user_id}
              className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2.5"
            >
              <div className="flex items-center gap-2 text-sm text-zinc-100">
                <Instagram className="h-3.5 w-3.5 text-zinc-500" /> @{a.ig_username}
              </div>
              {a.is_active && (
                <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Active
                </Badge>
              )}
            </li>
          ))}
          {igAccounts.length === 0 && (
            <li className="text-sm text-zinc-500">
              No Instagram Business account linked to your Pages yet.
            </li>
          )}
        </ul>
      </Card>

      {status.ads_management_granted && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-100">Connected Ad Accounts</h2>
          <ul className="space-y-2">
            {adAccounts.map((a) => (
              <li
                key={a.ad_account_id}
                className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2.5"
              >
                <div>
                  <div className="text-sm text-zinc-100">{a.ad_account_name}</div>
                  <div className="text-xs text-zinc-500">{a.currency}</div>
                </div>
                {a.is_active ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Active
                  </Badge>
                ) : (
                  <Button
                    onClick={() => setActiveAdAccount(a.ad_account_id)}
                    disabled={busy === a.ad_account_id} variant="outline" className="!py-1 text-xs">
                    {busy === a.ad_account_id ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Set active"
                    )}
                  </Button>
                )}
              </li>
            ))}
            {adAccounts.length === 0 && (
              <li className="text-sm text-zinc-500">No ad accounts found for this Facebook account.</li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
