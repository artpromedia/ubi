// SecureConfirm modal (C05 / G01), implementing the caller contract from
// navigation/routes.ts: { purpose: string; onProof: (proof: string) => void }.
// It COLLECTS a secret (e.g. wallet PIN) and hands it back to the caller,
// which submits it to its own endpoint — this screen verifies nothing itself
// and therefore claims nothing. The secret stays in component state only:
// never logged, never tracked, cleared on unmount.
import React, { useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { Screen, Text, Button, useTheme } from "@ubi/mobile-ui";
import type { RootStackParamList } from "../../navigation/routes";

export function SecureConfirmScreen() {
  const t = useTheme();
  const nav = useNavigation<{ goBack: () => void }>();
  const { params } = useRoute<RouteProp<RootStackParamList, "SecureConfirm">>();
  const [proof, setProof] = useState("");
  const valid = proof.length >= 4;
  return (
    <Screen
      title="Confirm it’s you"
      subtitle={params.purpose}
      onBack={nav.goBack}
      footer={
        <Button
          testID="common.secureConfirm.submit"
          label="Confirm"
          accessibilityLabel="Confirm"
          disabled={!valid}
          onPress={() => {
            const p = proof;
            setProof("");
            params.onProof(p);
            nav.goBack();
          }}
        />
      }
    >
      <View style={{ gap: 12, paddingTop: 12 }}>
        <Text variant="bodySm" tone="text2">
          Enter your wallet PIN. It’s checked by the server when the action runs
          — this screen only passes it along.
        </Text>
        <TextInput
          testID="common.secureConfirm.input"
          accessibilityLabel="Wallet PIN"
          value={proof}
          onChangeText={(v) => setProof(v.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          placeholder="••••"
          placeholderTextColor={t.colors.text3}
          style={[
            t.type.display as TextStyle,
            {
              color: t.colors.text,
              letterSpacing: 8,
              textAlign: "center",
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
              paddingVertical: 10,
            },
          ]}
        />
      </View>
    </Screen>
  );
}
