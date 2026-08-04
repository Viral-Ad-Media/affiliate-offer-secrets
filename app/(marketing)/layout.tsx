import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import { createClient } from "@/lib/supabase/server";

// Resolves the session HERE rather than inside MarketingNav so a signed-in visitor never sees a
// "Sign in" button flash before a client-side check catches up — and so the exit-intent popup is
// never even mounted for someone who already has an account.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let navUser = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    navUser = {
      email: user.email ?? "",
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav user={navUser} />
      <div className="flex-1">{children}</div>
      <MarketingFooter />
    </div>
  );
}
