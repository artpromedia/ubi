// Real boot screen (C05 / G01): restores the Keychain session on cold start
// and decides Auth vs Main. No artwork theatrics — it resolves as fast as the
// Keychain read does, and a restore failure lands on Auth, never a dead end.
import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Text, useTheme } from "@ubi/mobile-ui";
import { restoreSession } from "../../api/auth";

export function SplashScreen() {
  const t = useTheme();
  const nav = useNavigation<{
    reset: (state: { index: number; routes: { name: string }[] }) => void;
  }>();
  useEffect(() => {
    let alive = true;
    void restoreSession().then((decision) => {
      if (!alive) return;
      nav.reset({
        index: 0,
        routes: [
          { name: decision === "authenticated" ? "Main" : "Onboarding" },
        ],
      });
    });
    return () => {
      alive = false;
    };
  }, [nav]);
  return (
    <View
      accessibilityLabel="UBI Driver is starting"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        backgroundColor: t.colors.bg,
      }}
    >
      <Text variant="display">UBI Driver</Text>
      <ActivityIndicator color={t.colors.text2} />
    </View>
  );
}
