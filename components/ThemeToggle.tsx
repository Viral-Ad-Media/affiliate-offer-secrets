"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type Theme = "system" | "light" | "dark";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

// Applies a theme choice to <html>. Mirrors components/ThemeScript.tsx's logic exactly — that
// one runs pre-paint from localStorage, this one runs when the user changes the setting.
export function applyTheme(theme: Theme) {
  const light =
    theme === "light" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.classList.toggle("light", light);
}

export default function ThemeToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  // Starts as null so the first client render matches the server HTML (which can't know the
  // stored preference) — the real value lands in the effect below, no hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as Theme | null) ?? "system";
    setTheme(stored);
  }, []);

  // While "system" is selected, follow OS changes live (a user flipping their laptop to dark at
  // sunset should see the app follow without a reload).
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  const active = theme ?? "system";

  if (iconOnly) {
    // Collapsed rail: cycle through the three modes with one button.
    const current = OPTIONS.find((o) => o.value === active) ?? OPTIONS[0];
    const Icon = current.icon;
    return (
      <button
        type="button"
        title={`Theme: ${current.label} (click to change)`}
        onClick={() => choose(OPTIONS[(OPTIONS.findIndex((o) => o.value === active) + 1) % OPTIONS.length].value)}
        className="flex items-center justify-center rounded-lg border border-ink-600 px-2.5 py-1.5 text-zinc-400 hover:border-ink-500 hover:text-zinc-100"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-ink-600 p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const isActive = active === o.value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.label}
            aria-pressed={isActive}
            onClick={() => choose(o.value)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[12px] transition-colors ${
              isActive ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
