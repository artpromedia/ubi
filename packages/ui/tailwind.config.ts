/**
 * UBI Tailwind CSS Configuration
 *
 * This is the shared Tailwind configuration preset for all UBI web applications.
 * Import this in your app's tailwind.config.ts as a preset.
 *
 * @example
 * ```ts
 * import type { Config } from "tailwindcss";
 * import sharedConfig from "@ubi/ui/tailwind.config";
 *
 * const config: Config = {
 *   content: ["./src/** /*.{js,ts,jsx,tsx,mdx}"],
 *   presets: [sharedConfig],
 * };
 *
 * export default config;
 * ```
 */

import type { Config } from "tailwindcss";
import { ubiPreset } from "./src/theme/preset";

const config: Partial<Config> = {
  ...ubiPreset,
  content: [],
};

export default config;
