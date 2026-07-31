import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JobsQueue from "@/components/JobsQueue";

export const dynamic = "force-dynamic";

export default async function JobsSettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Jobs queue</h1>
        <p className="text-sm text-zinc-400">
          Discovery and campaign-build work, newest first. Jobs start processing automatically
          within seconds of being queued and retry themselves on failure — this is here for when
          something looks stuck, not as part of the normal loop.
        </p>
      </header>
      <JobsQueue />
    </main>
  );
}
