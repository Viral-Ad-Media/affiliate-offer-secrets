import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId } from "@/lib/workspace";
import DomainsPanel from "@/components/DomainsPanel";
import LoadFailed from "@/components/LoadFailed";

export default async function DomainsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Explicit workspace filter on top of RLS, the standing belt-and-braces rule: the policy decides
  // whether a row is visible AT ALL, this decides which of YOUR workspaces you're looking at.
  // Without it a member of two workspaces saw both workspaces' domains merged into one list.
  const ws = await currentWorkspaceId();
  if (!ws) redirect("/login");

  // The list query's error is captured, not discarded. This exact page is why LoadFailed exists:
  // its embed broke (PGRST201 after 0088) and the ignored error rendered as "no domains yet" over
  // a live domain serving five funnels — which led the operator to re-add it and hit a
  // duplicate-claim dead end. See components/LoadFailed.tsx.
  const [{ data: domains, error: domainsError }, { data: campaigns }] = await Promise.all([
    supabase
      .from("custom_domains")
      // The FK hint is REQUIRED, not stylistic: 0088 added a second (composite, workspace-scoped)
      // FK between these tables, and an unhinted embed has been PGRST201 "ambiguous relationship"
      // ever since — the whole query errors, the ignored-error destructure below turned that into
      // an empty panel, and an operator re-added a live domain because the list showed nothing.
      // Same hint needed anywhere these two tables (or routes ↔ campaigns) embed each other.
      .select(
        "*, custom_domain_routes!custom_domain_routes_domain_id_fkey(id, path, destination, campaign_id, created_at)"
      )
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("id, product_id, products(product_title)")
      .eq("workspace_id", ws)
      .eq("status", "ready"),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Domains</h1>
        <p className="text-sm text-zinc-400">
          Connect your own domain and publish bridge (lead-capture landing) pages under it — one
          domain can host several campaigns, each at its own path.
        </p>
      </header>

      {/* On error the panel does NOT render — not even its add form. An add form over a failed
          list is precisely the trap this guards against: the list reads empty, the operator
          re-adds a domain they already hold, and collides with their own verified claim. */}
      {domainsError ? (
        <LoadFailed what="your domains" detail={domainsError.message} />
      ) : (
        <DomainsPanel
          initialDomains={domains ?? []}
          campaigns={(campaigns ?? []).map((c: any) => ({
            id: c.id,
            title: c.products?.product_title ?? "Untitled",
          }))}
        />
      )}
    </main>
  );
}
