// Home-city picker for existing accounts whose User.homeCityId is not yet set (DEC-8).
// Fetches launched cities from GET /v1/auth/cities and commits via POST /v1/auth/city,
// which re-issues access and refresh tokens carrying the verified cityId claim.
import React, { useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Screen, Text, Button, Banner, Chip, useTheme } from "@ubi/mobile-ui";
import { authApi, authErrorMessage } from "../../api/auth";

export function CityPickerScreen() {
  const t = useTheme();
  const nav = useNavigation<{
    reset: (s: { index: number; routes: { name: string }[] }) => void;
    getParent: () =>
      | { reset: (s: { index: number; routes: { name: string }[] }) => void }
      | undefined;
  }>();
  const [cityId, setCityId] = useState<string>("");

  const citiesQuery = useQuery({
    queryKey: ["auth", "cities"],
    queryFn: () => authApi.listCities(),
  });

  const choose = useMutation({
    mutationFn: () => authApi.selectCity(cityId),
    onSuccess: () => {
      (nav.getParent() ?? nav).reset({ index: 0, routes: [{ name: "Main" }] });
    },
  });

  const cities = citiesQuery.data ?? [];

  return (
    <Screen
      title="Choose your city"
      subtitle="Pick the city where you ride most so fares, safety, and local services match."
      footer={
        <Button
          testID="rider.auth.confirmCity"
          label="Continue"
          accessibilityLabel="Confirm home city"
          disabled={!cityId || citiesQuery.isLoading}
          loading={choose.isPending}
          onPress={() => choose.mutate()}
        />
      }
    >
      <View style={{ gap: 16, paddingTop: 12 }}>
        {citiesQuery.isLoading ? (
          <View style={{ paddingVertical: 24, alignItems: "center" }}>
            <ActivityIndicator color={t.colors.text2} />
          </View>
        ) : null}

        {citiesQuery.isError ? (
          <Banner
            tone="error"
            title="Could not load cities"
            body={authErrorMessage(citiesQuery.error)}
          />
        ) : null}

        {cities.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {cities.map((c) => (
              <Chip
                key={c.id}
                testID={`rider.auth.city.${c.id}`}
                label={`${c.name} (${c.id})`}
                selected={cityId === c.id}
                onPress={() => setCityId(c.id)}
              />
            ))}
          </View>
        ) : null}

        {!citiesQuery.isLoading &&
        !citiesQuery.isError &&
        cities.length === 0 ? (
          <Text variant="bodySm" tone="text2">
            No launched cities are currently available. Please try again
            shortly.
          </Text>
        ) : null}

        {choose.isError ? (
          <Banner
            tone="error"
            title="City not saved"
            body={authErrorMessage(choose.error)}
          />
        ) : null}
      </View>
    </Screen>
  );
}
