import React from 'react';
import { View, type ViewProps } from 'react-native';
import { useTheme } from './theme';

export function Card({ style, emphasis, tone, children, ...rest }: ViewProps & { emphasis?: boolean; tone?: 'default' | 'warn' | 'error' | 'ok' | 'inverse' }) {
  const t = useTheme();
  const border = tone === 'warn' ? t.colors.warn : tone === 'error' ? t.colors.errorTint : tone === 'ok' ? t.colors.okTint : emphasis ? t.colors.text : t.mode === 'dark' ? t.colors.border : 'transparent';
  const bg = tone === 'inverse' ? t.colors.inverse : t.colors.card;
  return (
    <View {...rest} style={[{ backgroundColor: bg, borderRadius: t.radius.cardLg, padding: 14, borderWidth: emphasis ? 1.5 : 1, borderColor: border, shadowColor: '#000', shadowOpacity: t.mode === 'dark' ? 0 : 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: t.mode === 'dark' ? 0 : 1 }, style]}>
      {children}
    </View>
  );
}
