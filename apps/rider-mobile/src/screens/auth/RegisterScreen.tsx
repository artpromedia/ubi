// Registration (C05 / G01) against POST /v1/auth/register (role RIDER), which
// sends the verification OTP itself; success hands off to the same code entry
// as sign-in. Country is ISO-3166 alpha-2, defaulted to NG for the pilot city
// until the profile/location port carries it.
import React, { useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Screen, Text, Button, Banner, useTheme } from "@ubi/mobile-ui";
import { authApi, authErrorMessage } from "../../api/auth";

export function RegisterScreen() {
  const t = useTheme();
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const normalized = phone.replace(/[^\d+]/g, "");
  const valid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    normalized.length >= 10 &&
    normalized.length <= 15;
  const register = useMutation({
    mutationFn: () =>
      authApi.register({
        phone: normalized,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        country: "NG",
      }),
    onSuccess: () => nav.navigate("Otp", { phone: normalized }),
  });
  const field = (
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    testID: string,
    keyboard?: "phone-pad",
  ) => (
    <View style={{ gap: 4 }}>
      <Text variant="label" tone="text2">
        {label}
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboard}
        placeholderTextColor={t.colors.text3}
        style={[
          t.type.body as TextStyle,
          {
            color: t.colors.text,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.border,
            paddingVertical: 8,
          },
        ]}
      />
    </View>
  );
  return (
    <Screen
      title="Create your account"
      onBack={nav.goBack}
      footer={
        <Button
          testID="rider.auth.createAccount"
          label="Create account"
          accessibilityLabel="Create account"
          disabled={!valid}
          loading={register.isPending}
          onPress={() => register.mutate()}
        />
      }
    >
      <View style={{ gap: 16, paddingTop: 12 }}>
        {field("First name", firstName, setFirstName, "rider.auth.firstName")}
        {field("Last name", lastName, setLastName, "rider.auth.lastName")}
        {field(
          "Phone number",
          phone,
          setPhone,
          "rider.auth.phone",
          "phone-pad",
        )}
        {register.isError ? (
          <Banner
            tone="error"
            title="Account not created"
            body={authErrorMessage(register.error)}
          />
        ) : null}
      </View>
    </Screen>
  );
}
