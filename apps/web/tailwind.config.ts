import type { Config } from "tailwindcss";

/**
 * Tailwind CSS v4 is configured CSS-first via the `@theme` block in
 * `app/globals.css`. This file only declares the content sources Tailwind
 * scans for class names, plus the dark-mode strategy. Design tokens
 * (colors, radii, fonts) live in `globals.css`.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
};

export default config;
