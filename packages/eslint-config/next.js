/**
 * UBI Next.js ESLint Configuration
 *
 * For Next.js applications in the monorepo.
 * Extends React config with Next.js-specific rules.
 */

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["./react.js", "next/core-web-vitals"],
  rules: {
    // ===========================================
    // Next.js Specific Rules
    // ===========================================

    // Allow default exports for pages and API routes
    "import/no-default-export": "off",

    // Next.js handles React imports
    "react/react-in-jsx-scope": "off",

    // Allow Next.js <Image> component
    "@next/next/no-img-element": "warn",

    // Ensure proper use of next/link
    "@next/next/no-html-link-for-pages": "error",

    // Performance rules important for African low-bandwidth networks
    "@next/next/no-sync-scripts": "error",

    // Allow async client components (Next.js 15+)
    "@next/next/no-async-client-component": "error",

    // ===========================================
    // Relaxed Rules for Build (warnings not errors)
    // ===========================================

    // Import order - warn only
    "import/order": "warn",

    // Function component definitions - warn only
    "react/function-component-definition": "warn",

    // Curly braces - warn only
    curly: "warn",

    // Unused vars - warn only
    "@typescript-eslint/no-unused-vars": "warn",

    // Self-closing components - warn only
    "react/self-closing-comp": "warn",

    // Accessibility rules - warn only for now
    "jsx-a11y/anchor-is-valid": "warn",
    "jsx-a11y/click-events-have-key-events": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",

    // ===========================================
    // Adjusted Rules for Next.js Patterns
    // ===========================================

    // Next.js often requires default exports
    "import/prefer-default-export": "off",

    // Allow spreading props in JSX for component composition
    "react/jsx-props-no-spreading": "off",

    // Next.js API routes use `req` and `res` naming
    "@typescript-eslint/naming-convention": [
      "error",
      {
        selector: "interface",
        format: ["PascalCase"],
        custom: {
          regex: "^I[A-Z]",
          match: false,
        },
      },
      {
        selector: "typeAlias",
        format: ["PascalCase"],
      },
    ],
  },
  overrides: [
    // Pages and API routes can have default exports
    {
      files: [
        "src/app/**/*.tsx",
        "src/app/**/*.ts",
        "src/pages/**/*.tsx",
        "src/pages/**/*.ts",
        "app/**/*.tsx",
        "app/**/*.ts",
        "pages/**/*.tsx",
        "pages/**/*.ts",
      ],
      rules: {
        "import/no-default-export": "off",
      },
    },
    // Config files
    {
      files: [
        "next.config.js",
        "next.config.mjs",
        "tailwind.config.js",
        "tailwind.config.ts",
        "postcss.config.js",
      ],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
        "import/no-default-export": "off",
      },
    },
  ],
};
