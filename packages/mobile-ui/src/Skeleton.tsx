import { View } from 'react-native';
import { useTheme } from './theme';
export function Skeleton({ height = 16, width = '100%', radius }: { height?: number; width?: number | string; radius?: number }) {
  const t = useTheme();
  return <View accessibilityLabel="Loading" style={{ height, width: width as number, borderRadius: radius ?? t.radius.control, backgroundColor: t.colors.bg2 }} />;
}
