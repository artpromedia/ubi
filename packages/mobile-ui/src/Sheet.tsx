import React from 'react';
import { Modal, Pressable, View, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';

/** Bottom sheet on a dimmed overlay. Max 92% height; scrolls inside. Dismiss by tapping the overlay or the grabber. */
export function Sheet({ visible, onDismiss, children, testID }: { visible: boolean; onDismiss: () => void; children: React.ReactNode; testID?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable accessibilityLabel="Dismiss" onPress={onDismiss} style={{ flex: 1, backgroundColor: t.colors.overlay }} />
      <View testID={testID} style={{ maxHeight: '92%', backgroundColor: t.colors.card, borderTopLeftRadius: Platform.OS === 'android' ? t.radius.sheetAndroid : t.radius.sheet, borderTopRightRadius: Platform.OS === 'android' ? t.radius.sheetAndroid : t.radius.sheet, paddingTop: 10, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16) + 18 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.colors.border, alignSelf: 'center', marginBottom: 14 }} />
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}
