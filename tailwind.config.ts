import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0e14",
          900: "#0f1420",
          800: "#161d2e",
          700: "#1f2940",
          600: "#2b3a5c",
        },
      },
    },
  },
  plugins: [],
};

export default config;
