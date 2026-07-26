import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DomainsPanel from "@/components/DomainsPanel";

export default async function DomainsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: domains }, { data: campaigns }] = await Promise.all([
    supabase
      .from("custom_domains")
      .select("*, custom_domain_routes(id, path, destination, campaign_id, created_at)")
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("id, product_id, products(product_title)")
      .eq("status", "ready"),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Domains</h1>
        <p className="text-sm text-zinc-400">
          Connect your own domain and publish presell/bridge pages under it — one domain can host
          several campaigns, each at its own path.
        </p>
      </header>

      <DomainsPanel
        initialDomains={domains ?? []}
        campaigns={(campaigns ?? []).map((c: any) => ({
          id: c.id,
          title: c.products?.product_title ?? "Untitled",
        }))}
      />
    </main>
  );
}
