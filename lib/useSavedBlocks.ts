"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SavedBlock = { id: string; name: string; block: unknown };

/**
 * The workspace's reusable-block library (0116) — save a section once, drop it into any funnel or
 * post. Reads/writes go straight through the browser client against saved_blocks' workspace-member
 * RLS (the useSplitTest / CreativeItemCard precedent) — there's no external side effect and no
 * public serving, so no wrapping route or RPC. Scoped to the ACTIVE workspace (current_workspace_id)
 * so a member of two workspaces sees one library at a time, not both merged.
 */
export function useSavedBlocks() {
  const [saved, setSaved] = useState<SavedBlock[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data: ws } = await supabase.rpc("current_workspace_id");
    let q = supabase.from("saved_blocks").select("id, name, block").order("created_at", { ascending: false }).limit(100);
    if (ws) q = q.eq("workspace_id", ws as string);
    const { data } = await q;
    setSaved((data ?? []) as SavedBlock[]);
    setReady(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (name: string, block: unknown) => {
      const clean = name.trim().slice(0, 120);
      if (!clean) return;
      // workspace_id is stamped by the saved_blocks_stamp_workspace trigger; user_id defaults to
      // the caller. We only supply what the caller actually chose.
      const {
        data: { user },
      } = await createClient().auth.getUser();
      const { error } = await createClient()
        .from("saved_blocks")
        .insert({ name: clean, block, user_id: user?.id });
      if (!error) await reload();
      return error?.message ?? null;
    },
    [reload]
  );

  const remove = useCallback(
    async (id: string) => {
      await createClient().from("saved_blocks").delete().eq("id", id);
      await reload();
    },
    [reload]
  );

  return { saved, ready, save, remove, reload };
}
