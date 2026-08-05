import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Whole-app type scale, nudged up roughly one pixel per step. Overriding the SCALE rather
      // than the root font size is deliberate: Tailwind's spacing units are rem too, so bumping
      // html{font-size} would inflate every padding, gap and width alongside the text and reflow
      // the dense tables this app is mostly made of. This grows text only.
      //
      // Line heights are raised with the sizes — leaving Tailwind's defaults would tighten every
      // paragraph as the text grew, which reads as cramped rather than bigger.
      //
      // Does NOT touch the published funnel or blog pages: those carry their own <style> blocks in
      // lib/engine/renderPages.ts and lib/blog.ts and are served to real ad traffic, so their
      // typography is a separate, deliberate decision from the operator's own UI.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.125rem" }], // 13px, was 12
        sm: ["0.9375rem", { lineHeight: "1.375rem" }], // 15px, was 14
        base: ["1.0625rem", { lineHeight: "1.625rem" }], // 17px, was 16
        lg: ["1.1875rem", { lineHeight: "1.8125rem" }], // 19px, was 18
        xl: ["1.3125rem", { lineHeight: "1.875rem" }], // 21px, was 20
        "2xl": ["1.5625rem", { lineHeight: "2.0625rem" }], // 25px, was 24
        "3xl": ["1.9375rem", { lineHeight: "2.3125rem" }], // 31px, was 30
        "4xl": ["2.375rem", { lineHeight: "2.625rem" }], // 38px, was 36
        "5xl": ["3.125rem", { lineHeight: "1" }], // 50px, was 48
        "6xl": ["3.875rem", { lineHeight: "1" }], // 62px, was 60
        "7xl": ["4.625rem", { lineHeight: "1" }], // 74px, was 72
      },
      colors: {
        // Dark-terminal / data-dense dashboard scale — deeper and more neutral than the old
        // navy-tinted ink scale, closer to true slate so status accent colors (emerald/amber/
        // sky/red) read cleanly against it instead of fighting a blue cast. Used directly by
        // every hand-rolled component/class in this app (card, chip, btn-*, data-table, etc) —
        // left untouched by the shadcn/ui semantic tokens added below.
        // Values live in app/globals.css as space-separated RGB channels so `.light` on <html>
        // can flip the whole app without touching a single component (~600 ink-*/zinc-* usages).
        // The `<alpha-value>` form keeps opacity modifiers (bg-ink-900/90) working.
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
        },
        // Text scale. Deliberately overrides Tailwind's built-in zinc: in dark mode these keep
        // their stock values, in light mode the top end INVERTS (zinc-100 = strongest text, so
        // it must go near-black) while the muted middle stays put. Shades not listed here fall
        // through to Tailwind's defaults.
        zinc: {
          100: "rgb(var(--zinc-100) / <alpha-value>)",
          200: "rgb(var(--zinc-200) / <alpha-value>)",
          300: "rgb(var(--zinc-300) / <alpha-value>)",
          400: "rgb(var(--zinc-400) / <alpha-value>)",
          500: "rgb(var(--zinc-500) / <alpha-value>)",
          600: "rgb(var(--zinc-600) / <alpha-value>)",
        },
        // Accent TEXT shades only (200-400). These are tuned for dark backgrounds and go
        // illegible on white, so light mode swaps them for the 600/700 equivalents. The 500+
        // shades (borders, filled buttons, tinted backgrounds like bg-emerald-500/15) read fine
        // in both themes and stay stock.
        emerald: {
          200: "rgb(var(--emerald-200) / <alpha-value>)",
          300: "rgb(var(--emerald-300) / <alpha-value>)",
          400: "rgb(var(--emerald-400) / <alpha-value>)",
        },
        amber: {
          300: "rgb(var(--amber-300) / <alpha-value>)",
          400: "rgb(var(--amber-400) / <alpha-value>)",
        },
        red: {
          300: "rgb(var(--red-300) / <alpha-value>)",
          400: "rgb(var(--red-400) / <alpha-value>)",
        },
        sky: {
          300: "rgb(var(--sky-300) / <alpha-value>)",
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
