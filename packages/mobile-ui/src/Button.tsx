import { Pressable, ActivityIndicator, View, type ViewStyle } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

type Kind = 'primary' | 'inverse' | 'secondary' | 'ghost' | 'danger';
export type ButtonProps = { label: string; onPress?: () => void; kind?: Kind; disabled?: boolean; loading?: boolean; trailing?: string; testID?: string; accessibilityLabel?: string; style?: ViewStyle; size?: 'lg' | 'md' };
export function Button({ label, onPress, kind = 'primary', disabled, loading, trailing, testID, accessibilityLabel, style, size = 'lg' }: ButtonProps) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.colors.primary : kind === 'inverse' ? t.colors.inverse : kind === 'danger' ? t.colors.errorTint : 'transparent';
  const fg = kind === 'primary' ? 'onPrimary' : kind === 'inverse' ? 'onInverse' : kind === 'danger' ? 'errorInk' : 'text';
  const border = kind === 'secondary' ? t.colors.border : 'transparent';
  const height = size === 'lg' ? t.targets.primaryButton : 48;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }} testID={testID} disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [{ height, borderRadius: t.radius.control, backgroundColor: bg, borderWidth: 1, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: trailing ? 'space-between' : 'center' }, style]}>
      {loading ? <ActivityIndicator color={t.colors[fg]} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: trailing ? 'space-between' : 'center', flex: 1 }}>
          <Text variant="bodyStrong" tone={fg}>{label}</Text>
          {trailing ? <Text variant="bodyStrong" tone={fg} tabular>{trailing}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}
