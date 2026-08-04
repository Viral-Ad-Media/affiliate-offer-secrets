import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId } from "@/lib/workspace";
import TeamSettings from "@/components/TeamSettings";
import WorkspaceSettings from "@/components/WorkspaceSettings";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The ACTIVE workspace, via the same resolver as every other page. This used to pick the first
  // membership by created_at (with a comment claiming switching didn't exist yet — it had shipped)
  // — so a user in two workspaces could have the switcher showing B while this page rendered and
  // edited A's name, slug, and members.
  const activeWorkspaceId = await currentWorkspaceId();
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, slug)")
    .eq("user_id", user.id)
    .eq("workspace_id", activeWorkspaceId)
    .maybeSingle();

  if (!membership) {
    return (
      <main className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold text-zinc-100">Team</h1>
        <p className="text-sm text-red-300">
          No workspace found for this account. That shouldn&apos;t happen — reload, and tell us if
          it persists.
        </p>
      </main>
    );
  }

  const ws = (membership as any).workspaces as { name: string; slug: string };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3400";

  return (
    <main className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Team</h1>
        <p className="text-sm text-zinc-400">
          Your workspace, its public URL, and who has access.
        </p>
      </header>

      <WorkspaceSettings
        workspaceId={membership.workspace_id as string}
        name={ws.name}
        slug={ws.slug}
        canEdit={membership.role === "owner" || membership.role === "admin"}
      />

      <TeamSettings workspaceId={membership.workspace_id as string} appUrl={appUrl} />
    </main>
  );
}
