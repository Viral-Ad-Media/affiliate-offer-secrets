import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Accepting an invitation requires a session, so an anonymous visitor is sent to sign in first
// with the invite path preserved — landing on a generic login and losing the invite is the most
// common way invite flows break.
export default async function InvitePage({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`);
  }

  const { error } = await supabase.rpc("accept_workspace_invitation", { p_token: params.token });

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-zinc-100">This invitation didn&apos;t work</h1>
        <p className="mt-2 text-sm text-zinc-400">{error.message}</p>
        <Link href="/dashboard" className={cn(buttonVariants(), "mt-6 inline-flex")}>
          Go to your dashboard
        </Link>
      </main>
    );
  }

  redirect("/settings/team");
}
