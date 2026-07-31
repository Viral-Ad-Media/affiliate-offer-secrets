import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Megaphone,
  Link2,
  Globe,
  Users,
  Send,
  Package,
  CheckCircle2,
  Contact,
  Radio,
} from "lucide-react";

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="stat-tile">
      <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
        {icon}
      </div>
      <div>
        <div className="stat-tile-value">{value}</div>
        <div className="stat-tile-label">{label}</div>
      </div>
    </div>
  );
}

const QUICK_LINKS = [
  {
    href: "/campaigns",
    icon: Megaphone,
    label: "Campaigns",
    description: "Discover products and build campaign kits.",
  },
  {
    href: "/connections",
    icon: Link2,
    label: "Connections",
    description: "Connect affiliate networks, Meta, and other platforms.",
  },
  {
    href: "/domains",
    icon: Globe,
    label: "Domains",
    description: "Publish presell and bridge pages on your own domain.",
  },
  {
    href: "/contacts",
    icon: Users,
    label: "Contacts",
    description: "See leads captured from your bridge pages.",
  },
  {
    href: "/emails/sequences",
    icon: Send,
    label: "Broadcast",
    description: "Send and schedule email sequences to your contacts.",
  },
];

export default async function Overview() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { count: productsCount },
    { count: campaignsReadyCount },
    { count: contactsCount },
    { count: activeSequencesCount },
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "ready"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("broadcast_sequences")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "active"),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Overview</h1>
        <p className="text-sm text-zinc-400">A summary of your account and where to go next.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={<Package className="h-5 w-5" />} label="Products tracked" value={productsCount ?? 0} />
        <StatTile
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Campaigns ready"
          value={campaignsReadyCount ?? 0}
        />
        <StatTile icon={<Contact className="h-5 w-5" />} label="Contacts captured" value={contactsCount ?? 0} />
        <StatTile
          icon={<Radio className="h-5 w-5" />}
          label="Active sequences"
          value={activeSequencesCount ?? 0}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Get started</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="card flex items-start gap-3 p-4 transition-colors hover:border-emerald-500/50"
            >
              <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
                <link.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-100">{link.label}</div>
                <div className="text-xs text-zinc-500">{link.description}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
