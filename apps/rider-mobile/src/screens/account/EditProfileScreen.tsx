// Account.Edit (C05 / G12, Phase 2): PATCH /v1/users/me. Only the fields the
// server accepts are editable here; nothing is saved until the server
// confirms it — the screen shows the server's own updated record afterward,
// never an optimistic local guess.
import React, { useEffect, useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Screen, Text, Button, Banner, useTheme } from "@ubi/mobile-ui";
import { accountApi } from "../../api/account";
import { errorText, LoadingState } from "../../components/states";

export function EditProfileScreen() {
  const t = useTheme();
  const nav = useNavigation<{ goBack: () => void }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["account", "me"], queryFn: accountApi.me });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (q.data && !hydrated) {
      setFirstName(q.data.firstName);
      setLastName(q.data.lastName);
      setEmail(q.data.email);
      setHydrated(true);
    }
  }, [q.data, hydrated]);
  const save = useMutation({
    mutationFn: () =>
      accountApi.update({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
      }),
    onSuccess: (user) => {
      qc.setQueryData(["account", "me"], user);
      nav.goBack();
    },
  });
  const valid = firstName.trim().length > 0 && lastName.trim().length > 0;
  const field = (
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    testID: string,
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
  if (!hydrated) {
    return (
      <Screen title="Edit profile" onBack={nav.goBack}>
        <LoadingState />
      </Screen>
    );
  }
  return (
    <Screen
      title="Edit profile"
      onBack={nav.goBack}
      footer={
        <Button
          testID="rider.profile.save"
          label="Save"
          accessibilityLabel="Save changes"
          disabled={!valid}
          loading={save.isPending}
          onPress={() => save.mutate()}
        />
      }
    >
      <View style={{ gap: 16, paddingTop: 12 }}>
        {field(
          "First name",
          firstName,
          setFirstName,
          "rider.profile.firstName",
        )}
        {field("Last name", lastName, setLastName, "rider.profile.lastName")}
        {field("Email", email, setEmail, "rider.profile.email")}
        {save.isError ? (
          <Banner
            tone="error"
            title="Couldn’t save"
            body={errorText(save.error)}
          />
        ) : null}
      </View>
    </Screen>
  );
}
