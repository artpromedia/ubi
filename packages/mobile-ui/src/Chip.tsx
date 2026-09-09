import { Pressable } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress?: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ minHeight: t.targets.min, paddingHorizontal: 14, justifyContent: 'center', borderRadius: t.radius.chip, backgroundColor: selected ? t.colors.inverse : t.colors.card, borderWidth: 1, borderColor: selected ? t.colors.inverse : t.colors.border }}>
      <Text variant="bodySmStrong" tone={selected ? 'onInverse' : 'text'}>{label}</Text>
    </Pressable>
  );
}
