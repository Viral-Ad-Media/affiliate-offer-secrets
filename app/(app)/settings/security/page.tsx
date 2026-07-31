import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SecuritySettings from "@/components/SecuritySettings";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Security</h1>
        <p className="text-sm text-zinc-400">Your password and active sessions.</p>
      </header>
      <SecuritySettings email={user.email ?? ""} />
    </main>
  );
}
