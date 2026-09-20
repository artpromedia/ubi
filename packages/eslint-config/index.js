/**
 * UBI ESLint Configuration - Main Export
 *
 * Re-exports all configurations for easy importing.
 *
 * Usage in package.json or .eslintrc.js:
 * - Next.js apps: { "extends": "@ubi/eslint-config/next" }
 * - React libraries: { "extends": "@ubi/eslint-config/react" }
 * - Node.js services: { "extends": "@ubi/eslint-config/node" }
 * - Base/utilities: { "extends": "@ubi/eslint-config/base" }
 */

module.exports = require("./base.js");
