import { View } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

export function Banner({ tone = 'warn', title, body, testID }: { tone?: 'warn' | 'error' | 'ok' | 'info' | 'neutral'; title?: string; body: string; testID?: string }) {
  const t = useTheme();
  const bg = tone === 'warn' ? t.colors.warnTint : tone === 'error' ? t.colors.errorTint : tone === 'ok' ? t.colors.okTint : tone === 'info' ? t.colors.infoTint : t.colors.bg2;
  const dot = tone === 'warn' ? t.colors.warn : tone === 'error' ? t.colors.error : tone === 'ok' ? t.colors.ok : tone === 'info' ? t.colors.info : t.colors.text3;
  return (
    <View testID={testID} accessibilityRole="alert" style={{ backgroundColor: bg, borderRadius: t.radius.control, padding: 12, flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot, marginTop: 6 }} />
      <View style={{ flex: 1 }}>
        {title ? <Text variant="bodySmStrong">{title}</Text> : null}
        <Text variant="caption">{body}</Text>
      </View>
    </View>
  );
}
