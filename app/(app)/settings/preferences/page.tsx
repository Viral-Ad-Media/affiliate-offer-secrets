import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ThemeToggle from "@/components/ThemeToggle";
import { Card } from "@/components/ui/card";
import { Palette } from "lucide-react";

// Preferences: how the app looks and behaves for YOU — distinct from Profile (who you are) and
// the workspace-scoped pages. Appearance moved here from Profile; the theme control is the same
// one at the bottom of the sidebar, not a second setting.
export default async function PreferencesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
    </main>
  );
}
