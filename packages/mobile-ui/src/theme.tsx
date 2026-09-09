import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { colorsFor, type Colors, type Mode, space, radius, targets, type as typeScale } from '@ubi/mobile-tokens';

export type Theme = { mode: Mode; colors: Colors; space: typeof space; radius: typeof radius; targets: typeof targets; type: typeof typeScale };
const ThemeContext = createContext<Theme | undefined>(undefined);
/** defaultMode: rider ships light-default, driver dark-default; 'system' follows the OS. */
export function ThemeProvider({ defaultMode, children }: { defaultMode: Mode | 'system'; children: React.ReactNode }) {
  const scheme = useColorScheme();
  const mode: Mode = defaultMode === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : defaultMode;
  const value = useMemo<Theme>(() => ({ mode, colors: colorsFor(mode), space, radius, targets, type: typeScale }), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('ThemeProvider missing');
  return t;
}
