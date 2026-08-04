"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { classifyHost, workspaceOrigin } from "@/lib/host";

type Membership = {
  workspace_id: string;
  role: string;
  workspaces: { name: string; slug: string } | null;
};

// Which workspace the app is currently showing. With subdomains (Phase 3), the URL is the source
// of truth: on a workspace subdomain the active workspace is the host's, whatever
// active_workspace_id says, and switching NAVIGATES to the other workspace's own origin.
// set_active_workspace is still written first so a later landing on the canonical host (an OAuth
// return, a bookmark) redirects to the same place. When the target origin is the current one
// (no root domain configured, or dev without subdomains) this degrades to the pre-subdomain
// behavior: write the RPC, router.refresh().
//
// This is a UX control, not a security one: RLS already refuses rows from a workspace you're not
// in, so the worst a broken switcher can do is show you the wrong workspace of your OWN.
export default function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("workspace_members").select("workspace_id, role, workspaces(name, slug)"),
      supabase.rpc("current_workspace_id"),
    ]).then(([m, ws]) => {
      const memberships = (m.data ?? []) as unknown as Membership[];
      setRows(memberships);
      // Host wins over the account's stored active workspace — the checkmark must agree with the
      // URL, or the switcher claims one workspace while the page shows another.
      const hostKind = classifyHost(window.location.host);
      const fromHost =
        hostKind.kind === "workspace"
          ? memberships.find((r) => r.workspaces?.slug === hostKind.slug)?.workspace_id
          : undefined;
      setActiveId(fromHost ?? ((ws.data as string | null) ?? null));
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // One workspace is the common case — showing a picker that can only pick the thing you're
  // already in is noise, so it renders nothing at all until there's a real choice to make.
  if (rows.length < 2) return null;

  const active = rows.find((r) => r.workspace_id === activeId);
  const label = active?.workspaces?.name ?? "Workspace";

  async function choose(id: string) {
    if (id === activeId) return setOpen(false);
    setBusy(id);
    const { error } = await createClient().rpc("set_active_workspace", { p_workspace_id: id });
    setBusy(null);
    if (error) return;
    setActiveId(id);
    setOpen(false);

    const slug = rows.find((r) => r.workspace_id === id)?.workspaces?.slug;
    const target = slug ? workspaceOrigin(slug) : "";
    if (target && target !== window.location.origin) {
      // Cross-origin: a real navigation, keeping the current path — /contacts in workspace A
      // becomes /contacts in workspace B. The auth cookie is domain-wide (Phase 3 S2), so the
      // session survives the hop.
      window.location.assign(`${target}${window.location.pathname}${window.location.search}`);
      return;
    }
    router.refresh();
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? label : undefined}
        className={`flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-2 text-sm text-zinc-300 hover:border-ink-600 hover:text-zinc-100 ${
          collapsed ? "justify-center" : ""
        }`}
      >
        <Building2 className="h-4 w-4 shrink-0 text-emerald-400" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-full min-w-[13rem] overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-lg">
          {rows.map((r) => (
            <button
              key={r.workspace_id}
              onClick={() => choose(r.workspace_id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-ink-800 hover:text-zinc-100"
            >
              {busy === r.workspace_id ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : r.workspace_id === activeId ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{r.workspaces?.name ?? "Workspace"}</span>
              <span className="shrink-0 text-xs text-zinc-600">{r.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
