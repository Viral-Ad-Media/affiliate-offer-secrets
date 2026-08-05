"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import NewFunnelDialog from "@/components/NewFunnelDialog";
import type { FunnelStart } from "@/lib/funnelTypes";
import { Button } from "@/components/ui/button";

/**
 * "New funnel" on the Funnels list. Builds the pages by hand — no AI, no credits — as the
 * alternative to Promote, which generates a whole campaign kit and charges for it.
 */
export default function NewFunnelButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create(typeKey: string, name: string, start: FunnelStart) {
    setBusy(true);
    try {
      const res = await fetch("/api/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: typeKey, name, start }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not create the funnel");
        return;
      }
      setOpen(false);
      // Straight into the editor — the funnel exists but every page is scaffolding until it's
      // edited, so the list view would be a dead end.
      router.push(`/funnels/${json.campaign_id}`);
    } catch {
      toast.error("Could not create the funnel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="text-sm">
        <Plus className="h-4 w-4" /> New funnel
      </Button>
      <NewFunnelDialog open={open} onOpenChange={setOpen} busy={busy} onConfirm={create} />
    </>
  );
}
