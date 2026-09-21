// Phone sign-in (C05 / G01) against POST /v1/auth/login/otp. The server never
// reveals whether a number exists; this screen only reports what the server
// said and moves to code entry once the OTP send is acknowledged.
import React, { useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Screen, Text, Button, Banner, useTheme } from "@ubi/mobile-ui";
import { authApi, authErrorMessage } from "../../api/auth";

const normalizePhone = (raw: string) => raw.replace(/[^\d+]/g, "");

export function LoginScreen() {
  const t = useTheme();
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
  }>();
  const [phone, setPhone] = useState("");
  const normalized = normalizePhone(phone);
  const valid = normalized.length >= 10 && normalized.length <= 15;
  const send = useMutation({
    mutationFn: () => authApi.requestOtp(normalized),
    onSuccess: () => nav.navigate("Otp", { phone: normalized }),
  });
  return (
    <Screen
      title="Sign in"
      subtitle="We’ll text a 6-digit code to this number"
      footer={
        <Button
          testID="driver.auth.sendCode"
          label="Send code"
          accessibilityLabel="Send code"
          disabled={!valid}
          loading={send.isPending}
          onPress={() => send.mutate()}
        />
      }
    >
      <View style={{ gap: 12, paddingTop: 12 }}>
        <Text variant="label" tone="text2">
          Phone number
        </Text>
        <TextInput
          testID="driver.auth.phone"
          accessibilityLabel="Phone number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="+234 801 234 5678"
          placeholderTextColor={t.colors.text3}
          style={[
            t.type.heading as TextStyle,
            {
              color: t.colors.text,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
              paddingVertical: 10,
            },
          ]}
        />
        {send.isError ? (
          <Banner
            tone="error"
            title="Code not sent"
            body={authErrorMessage(send.error)}
          />
        ) : null}
        <Button
          testID="driver.auth.register"
          label="New to UBI? Create a driver account"
          kind="ghost"
          accessibilityLabel="Create a driver account"
          onPress={() => nav.navigate("Register")}
        />
      </View>
    </Screen>
  );
}
