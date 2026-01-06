/**
 * UBI CSS Variables
 *
 * These CSS custom properties are used throughout the design system.
 * Apply these to your :root or html element.
 */

export const cssVariables = {
  light: {
    "--background": "0 0% 100%",
    "--foreground": "222.2 84% 4.9%",
    "--card": "0 0% 100%",
    "--card-foreground": "222.2 84% 4.9%",
    "--popover": "0 0% 100%",
    "--popover-foreground": "222.2 84% 4.9%",
    "--primary": "142 76% 36%", // UBI Green
    "--primary-foreground": "0 0% 100%",
    "--secondary": "24 95% 64%", // UBI Orange
    "--secondary-foreground": "0 0% 100%",
    "--muted": "210 40% 96.1%",
    "--muted-foreground": "215.4 16.3% 46.9%",
    "--accent": "175 85% 40%", // UBI Teal
    "--accent-foreground": "0 0% 100%",
    "--destructive": "0 84.2% 60.2%",
    "--destructive-foreground": "0 0% 98%",
    "--border": "214.3 31.8% 91.4%",
    "--input": "214.3 31.8% 91.4%",
    "--ring": "142 76% 36%", // UBI Green
    "--radius": "0.5rem",
  },
  dark: {
    "--background": "222.2 84% 4.9%",
    "--foreground": "210 40% 98%",
    "--card": "222.2 84% 4.9%",
    "--card-foreground": "210 40% 98%",
    "--popover": "222.2 84% 4.9%",
    "--popover-foreground": "210 40% 98%",
    "--primary": "142 70% 45%", // UBI Green (lighter for dark mode)
    "--primary-foreground": "0 0% 100%",
    "--secondary": "24 90% 55%", // UBI Orange
    "--secondary-foreground": "0 0% 100%",
    "--muted": "217.2 32.6% 17.5%",
    "--muted-foreground": "215 20.2% 65.1%",
    "--accent": "175 80% 45%", // UBI Teal
    "--accent-foreground": "0 0% 100%",
    "--destructive": "0 62.8% 50%",
    "--destructive-foreground": "0 0% 98%",
    "--border": "217.2 32.6% 17.5%",
    "--input": "217.2 32.6% 17.5%",
    "--ring": "142 70% 45%", // UBI Green
    "--radius": "0.5rem",
  },
} as const;

/**
 * Generate CSS string for variables
 */
export function generateCSSVariables(mode: "light" | "dark"): string {
  const vars = cssVariables[mode];
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
}

/**
 * Complete CSS styles string
 */
// Export aliases for convenience
export const lightModeVariables = cssVariables.light;
export const darkModeVariables = cssVariables.dark;

export const globalStyles = `
@layer base {
  :root {
${generateCSSVariables("light")}
  }

  .dark {
${generateCSSVariables("dark")}
  }
}

@layer base {
  * {
    @apply border-border;
  }
  
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
  
  /* Focus visible styles for accessibility */
  :focus-visible {
    @apply outline-none ring-2 ring-ring ring-offset-2 ring-offset-background;
  }
  
  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  
  /* Selection styling */
  ::selection {
    @apply bg-primary/20 text-foreground;
  }
  
  /* Scrollbar styling */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    @apply bg-muted;
  }
  
  ::-webkit-scrollbar-thumb {
    @apply bg-muted-foreground/30 rounded-full;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    @apply bg-muted-foreground/50;
  }
}
`;

export default cssVariables;
