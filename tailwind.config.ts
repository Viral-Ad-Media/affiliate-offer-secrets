import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark-terminal / data-dense dashboard scale — deeper and more neutral than the old
        // navy-tinted ink scale, closer to true slate so status accent colors (emerald/amber/
        // sky/red) read cleanly against it instead of fighting a blue cast. Used directly by
        // every hand-rolled component/class in this app (card, chip, btn-*, data-table, etc) —
        // left untouched by the shadcn/ui semantic tokens added below.
        ink: {
          950: "#020617",
          900: "#0b1120",
          800: "#131b2e",
          700: "#1e293b",
          600: "#334155",
          500: "#475569",
        },
        // shadcn/ui semantic tokens (for components installed via components/ui/*, e.g. from
        // 21st.dev) — CSS variables defined in app/globals.css, hand-mapped to this app's own
        // ink/emerald palette (not shadcn's default slate/zinc) so any shadcn-registry component
        // renders on-theme immediately with zero per-component recoloring.
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "var(--font-body)", "ui-sans-serif", "sans-serif"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
