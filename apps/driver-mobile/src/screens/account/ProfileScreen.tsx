// Account.Profile (C05 / G12): a read view of GET /v1/users/me. Vehicle,
// documents, ratings and fleet arrangement have no audited server surface in
// this slice (api/unsupported.ts driverDocuments) and stay gated. Logout ends
// the server session first (best-effort) and always clears the local one.
import React, { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Screen, Text, Card, Row, Button } from "@ubi/mobile-ui";
import { accountApi } from "../../api/account";
import { authApi } from "../../api/auth";
import { LoadingState, ErrorState } from "../../components/states";

export function ProfileScreen() {
  type Nav = {
    getParent: () => (Nav & { reset: Reset }) | undefined;
  };
  type Reset = (s: { index: number; routes: { name: string }[] }) => void;
  const nav = useNavigation<Nav & { reset: Reset }>();
  const q = useQuery({ queryKey: ["account", "me"], queryFn: accountApi.me });
  const [loggingOut, setLoggingOut] = useState(false);
  const p = q.data;
  return (
    <Screen title="Profile">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !p ? (
        <LoadingState />
      ) : (
        <Card testID="driver.profile.card">
          <Text variant="display">{p.firstName + " " + p.lastName}</Text>
          <Text variant="bodySm" tone="text2">
            {p.phone}
          </Text>
          <Row label="Email" value={p.email} />
          <Row label="Status" value={p.status} last />
        </Card>
      )}
      <Button
        testID="driver.profile.logout"
        label="Sign out"
        kind="danger"
        accessibilityLabel="Sign out"
        loading={loggingOut}
        onPress={() => {
          setLoggingOut(true);
          void authApi.logout().finally(() => {
            // Profile sits two navigators deep (Root > Main tabs > Account
            // stack); `reset` never bubbles like `navigate` does, so it must
            // be dispatched on the Root navigator itself.
            nav
              .getParent()
              ?.getParent()
              ?.reset({
                index: 0,
                routes: [{ name: "Auth" }],
              });
          });
        }}
      />
    </Screen>
  );
}
