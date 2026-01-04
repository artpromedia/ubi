/**
 * Theme Provider
 *
 * Handles light/dark/system theme with smooth transitions.
 */

"use client";

import { useUIStore } from "@/store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = "system" }: ThemeProviderProps) {
  const { theme, setTheme } = useUIStore();
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  // Determine the actual theme based on system preference
  useEffect(() => {
    setMounted(true);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const resolveTheme = () => {
      if (theme === "system") {
        return mediaQuery.matches ? "dark" : "light";
      }
      return theme;
    };

    setResolvedTheme(resolveTheme());

    const handleChange = () => {
      if (theme === "system") {
        setResolvedTheme(mediaQuery.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // Apply theme class to document
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#191414" : "#FFFFFF"
      );
    }
  }, [resolvedTheme, mounted]);

  // Prevent flash of wrong theme
  if (!mounted) {
    return (
      <div style={{ visibility: "hidden" }}>
        {children}
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
