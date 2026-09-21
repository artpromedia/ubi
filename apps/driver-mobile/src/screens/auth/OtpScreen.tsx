// OTP verification (C05 / G01) against POST /v1/auth/verify-otp. Success is
// ONLY the server's { user, tokens } body: the Keychain session is saved by
// the api layer before navigation moves on. The code itself is never logged
// and never sent to analytics. A rider account is refused with a plain
// explanation instead of a broken driver session.
import React, { useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Screen, Text, Button, Banner, useTheme } from "@ubi/mobile-ui";
import { authApi, authErrorMessage } from "../../api/auth";
import type { AuthStackParamList } from "../../navigation/routes";

export function OtpScreen() {
  const t = useTheme();
  type Nav = {
    goBack: () => void;
    getParent: () => (Nav & { reset: Reset }) | undefined;
  };
  type Reset = (s: { index: number; routes: { name: string }[] }) => void;
  const nav = useNavigation<Nav & { reset: Reset }>();
  const { params } = useRoute<RouteProp<AuthStackParamList, "Otp">>();
  const [code, setCode] = useState("");
  const [wrongApp, setWrongApp] = useState(false);
  const verify = useMutation({
    mutationFn: () => authApi.verifyOtp(params.phone, code),
    onSuccess: (outcome) => {
      if (outcome.result === "wrong_app") {
        setWrongApp(true);
        return;
      }
      // This screen lives inside the Auth stack, nested under the Root
      // navigator. `reset` never bubbles to a parent navigator the way
      // `navigate` does, so it must be dispatched on the Root navigator.
      nav.getParent()?.reset({ index: 0, routes: [{ name: "Main" }] });
    },
  });
  const resend = useMutation({
    mutationFn: () => authApi.requestOtp(params.phone),
  });
  const valid = /^\d{6}$/.test(code);
  return (
    <Screen
      title="Enter the code"
      subtitle={"Sent to " + params.phone}
      onBack={nav.goBack}
      footer={
        <Button
          testID="driver.auth.verify"
          label="Verify"
          accessibilityLabel="Verify code"
          disabled={!valid || wrongApp}
          loading={verify.isPending}
          onPress={() => verify.mutate()}
        />
      }
    >
      <View style={{ gap: 12, paddingTop: 12 }}>
        <TextInput
          testID="driver.auth.otp"
          accessibilityLabel="6-digit code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          placeholderTextColor={t.colors.text3}
          style={[
            t.type.display as TextStyle,
            {
              color: t.colors.text,
              letterSpacing: 8,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
              paddingVertical: 10,
              textAlign: "center",
            },
          ]}
        />
        {wrongApp ? (
          <Banner
            tone="warn"
            title="This is a rider account"
            body="Sign in with the UBI app instead — this app is for drivers."
          />
        ) : null}
        {verify.isError ? (
          <Banner
            tone="error"
            title="Code not accepted"
            body={authErrorMessage(verify.error)}
          />
        ) : null}
        <Button
          testID="driver.auth.resend"
          label={resend.isSuccess ? "Code sent again" : "Resend code"}
          kind="ghost"
          accessibilityLabel="Resend code"
          disabled={resend.isPending || resend.isSuccess}
          onPress={() => resend.mutate()}
        />
        {resend.isError ? (
          <Text variant="bodySm" tone="errorInk">
            {authErrorMessage(resend.error)}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
