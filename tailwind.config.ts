import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        display: ["Nunito", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      colors: {
        mint: {
          50: "#e8f6f3",
          100: "#ccf0e8",
          200: "#99e0d1",
          300: "#66d1ba",
          400: "#33b29c",
          500: "#33b29c",
          600: "#2a9483",
          700: "#1e7a6d",
          800: "#165c52",
          900: "#0e3d37",
        },
        warm: {
          50: "#FAF9F6",
          100: "#F5F3EF",
          200: "#E8E6E1",
          300: "#D4D1CB",
          400: "#A0A5B2",
          500: "#6B7280",
          600: "#4B5563",
          700: "#374151",
          800: "#2D3142",
          900: "#1a1a2e",
        },
        coral: {
          400: "#F97066",
          500: "#EF4444",
        },
      },
    },
  },
  plugins: [],
};

export default config;
