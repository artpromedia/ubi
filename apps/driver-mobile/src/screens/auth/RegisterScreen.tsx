// Registration (CC-B00 / DEC-8) against POST /v1/auth/signup (role DRIVER), which
// requires a launched operating city from GET /v1/auth/cities and sends the verification
// OTP; success hands off to OtpScreen. Vehicle and document onboarding remain separate.
import React, { useEffect, useState } from "react";
import {
  View,
  TextInput,
  ActivityIndicator,
  type TextStyle,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Screen, Text, Button, Banner, Chip, useTheme } from "@ubi/mobile-ui";
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
  const [cityId, setCityId] = useState("");

  const citiesQuery = useQuery({
    queryKey: ["auth", "cities"],
    queryFn: () => authApi.listCities(),
  });

  useEffect(() => {
    const first = citiesQuery.data?.[0];
    if (!cityId && first) {
      setCityId(first.id);
    }
  }, [citiesQuery.data, cityId]);

  const selectedCity = citiesQuery.data?.find((c) => c.id === cityId);
  const normalized = phone.replace(/[^\d+]/g, "");
  const valid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    normalized.length >= 10 &&
    normalized.length <= 15 &&
    cityId.length > 0;

  const register = useMutation({
    mutationFn: () =>
      authApi.register({
        phone: normalized,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        cityId,
        country: selectedCity?.country ?? "NG",
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
      title="Create your driver account"
      onBack={nav.goBack}
      footer={
        <Button
          testID="driver.auth.createAccount"
          label="Create account"
          accessibilityLabel="Create account"
          disabled={!valid}
          loading={register.isPending}
          onPress={() => register.mutate()}
        />
      }
    >
      <View style={{ gap: 16, paddingTop: 12 }}>
        {field("First name", firstName, setFirstName, "driver.auth.firstName")}
        {field("Last name", lastName, setLastName, "driver.auth.lastName")}
        {field(
          "Phone number",
          phone,
          setPhone,
          "driver.auth.phone",
          "phone-pad",
        )}
        <View style={{ gap: 8 }}>
          <Text variant="label" tone="text2">
            Operating city
          </Text>
          {citiesQuery.isLoading ? (
            <ActivityIndicator color={t.colors.text2} />
          ) : citiesQuery.isError ? (
            <Banner
              tone="error"
              title="Cities unavailable"
              body={authErrorMessage(citiesQuery.error)}
            />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(citiesQuery.data ?? []).map((c) => (
                <Chip
                  key={c.id}
                  testID={`driver.auth.signupCity.${c.id}`}
                  label={`${c.name} (${c.id})`}
                  selected={cityId === c.id}
                  onPress={() => setCityId(c.id)}
                />
              ))}
            </View>
          )}
        </View>
        <Text variant="caption" tone="text3">
          Vehicle and document verification happen after your account is created
          — support will be in touch about next steps.
        </Text>
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
