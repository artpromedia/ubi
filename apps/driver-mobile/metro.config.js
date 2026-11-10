const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

/**
 * Metro configuration for UBI pnpm monorepo (RN 0.79).
 * Resolves workspace packages (@ubi/contracts, @ubi/mobile-*) and pnpm symlinks
 * while pinning singletons (react, react-native) to this app's node_modules.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    unstable_enableSymlinks: true,
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(monorepoRoot, "node_modules"),
    ],
    extraNodeModules: {
      "@babel/runtime": path.resolve(
        projectRoot,
        "node_modules/@babel/runtime",
      ),
      "@tanstack/react-query": path.resolve(
        projectRoot,
        "node_modules/@tanstack/react-query",
      ),
      react: path.resolve(projectRoot, "node_modules/react"),
      "react-native": path.resolve(projectRoot, "node_modules/react-native"),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
