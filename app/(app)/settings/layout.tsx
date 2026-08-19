import SettingsTabs from "@/components/SettingsTabs";

// One shell for every settings page: a heading and the tab bar, so moving between Profile /
// Security / Integrations / Domains is one click instead of a trip back through the sidebar's
// drill-down. Each child page keeps its own route and its own <h?> content below the tabs.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <SettingsTabs />
      </header>
      {children}
    </div>
  );
}
