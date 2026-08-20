import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { getWorkspaceGenerationDefaults } from "@/lib/generationSettings";
import ThemeToggle from "@/components/ThemeToggle";
import GenerationModelsPanel from "@/components/GenerationModelsPanel";
import { Card } from "@/components/ui/card";
import { Palette } from "lucide-react";

// Preferences: how the app looks and behaves for YOU — distinct from Profile (who you are) and
// the workspace-scoped pages. Appearance moved here from Profile; the theme control is the same
// one at the bottom of the sidebar, not a second setting.
//
// AI-generation defaults moved here from Integrations: Integrations is for CONNECTIONS (a token, an
// API key), while "which model writes your images and videos" is a behaviour setting — the same
// class of choice as appearance. It is workspace-scoped (the panel writes through
// set_workspace_generation_models, so it applies to every member), which the panel's own copy says.
export default async function PreferencesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();
  const genDefaults = ws
    ? await getWorkspaceGenerationDefaults(supabase, ws)
    : { image: null, video: null, dailyBudget: null };

  return (
    <main className="space-y-6">
      <Card as="section" className="space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Palette className="h-4 w-4 text-emerald-400" /> Appearance
        </div>
        <p className="text-xs text-zinc-500">
          Dark, light, or follow your system. The same control as the one at the bottom of the
          sidebar, not a second setting.
        </p>
        <div className="max-w-xs">
          <ThemeToggle />
        </div>
      </Card>

      <GenerationModelsPanel
        initialImage={genDefaults.image}
        initialVideo={genDefaults.video}
        initialBudget={genDefaults.dailyBudget}
      />
    </main>
  );
}
