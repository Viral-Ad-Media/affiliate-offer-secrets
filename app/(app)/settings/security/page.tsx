import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SecuritySettings from "@/components/SecuritySettings";
import AccountEmailPanel from "@/components/AccountEmailPanel";
import DeleteAccountPanel from "@/components/DeleteAccountPanel";

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
        <p className="text-sm text-zinc-400">
          Your password, sign-in email, active sessions — and deleting the account.
        </p>
      </header>
      <SecuritySettings email={user.email ?? ""} />
      <AccountEmailPanel email={user.email ?? ""} />
      <DeleteAccountPanel email={user.email ?? ""} />
    </main>
  );
}
