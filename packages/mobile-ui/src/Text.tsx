import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from './theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'bodySm' | 'bodySmStrong' | 'caption' | 'label' | 'money' | 'mono';
type Tone = 'text' | 'text2' | 'text3' | 'primaryInk' | 'warnInk' | 'errorInk' | 'link' | 'travelInk' | 'onPrimary' | 'onInverse' | 'onInverse2' | 'ok' | 'info';
export type UbiTextProps = TextProps & { variant?: Variant; tone?: Tone; align?: TextStyle['textAlign']; tabular?: boolean };
export function Text({ variant = 'body', tone = 'text', align, tabular, style, children, ...rest }: UbiTextProps) {
  const t = useTheme();
  const base = t.type[variant] as TextStyle;
  return (
    <RNText allowFontScaling maxFontSizeMultiplier={2} {...rest} style={[base, { color: t.colors[tone], textAlign: align }, tabular ? { fontVariant: ['tabular-nums'] } : null, variant === 'label' ? { textTransform: 'uppercase' } : null, style]}>
      {children}
    </RNText>
  );
}
