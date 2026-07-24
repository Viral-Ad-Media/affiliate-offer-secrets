import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark-terminal / data-dense dashboard scale — deeper and more neutral than the old
        // navy-tinted ink scale, closer to true slate so status accent colors (emerald/amber/
        // sky/red) read cleanly against it instead of fighting a blue cast.
        ink: {
          950: "#020617",
          900: "#0b1120",
          800: "#131b2e",
          700: "#1e293b",
          600: "#334155",
          500: "#475569",
        },
      },
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "var(--font-body)", "ui-sans-serif", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
