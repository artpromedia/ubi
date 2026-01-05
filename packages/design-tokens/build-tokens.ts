/**
 * Build script for design tokens using style-dictionary
 * This file runs the style-dictionary build process with our TypeScript config
 */

import StyleDictionary from "style-dictionary";
import config from "./style-dictionary.config";

async function build() {
  console.log("Building design tokens...");

  try {
    const sd = new StyleDictionary(config);
    await sd.buildAllPlatforms();
    console.log("Design tokens built successfully!");
  } catch (error) {
    console.error("Failed to build design tokens:", error);
    process.exit(1);
  }
}

build();
