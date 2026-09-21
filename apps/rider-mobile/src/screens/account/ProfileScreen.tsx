// Account.Profile (C05 / G12, Phase 2): a read view of GET /v1/users/me.
// Every field is exactly what user-service serves — no client-side guessing
// at a display name or a status the server hasn't sent. Logout ends the
// server session first (best-effort) and always clears the local one.
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Screen, Text, Card, Row, Button } from "@ubi/mobile-ui";
import { accountApi } from "../../api/account";
import { authApi } from "../../api/auth";
import { LoadingState, ErrorState } from "../../components/states";

export function ProfileScreen() {
  type Nav = {
    navigate: (n: string, p?: unknown) => void;
    getParent: () => (Nav & { reset: Reset }) | undefined;
  };
  type Reset = (s: { index: number; routes: { name: string }[] }) => void;
  const nav = useNavigation<Nav & { reset: Reset }>();
  const q = useQuery({ queryKey: ["account", "me"], queryFn: accountApi.me });
  const [loggingOut, setLoggingOut] = React.useState(false);
  const p = q.data;
  return (
    <Screen title="Profile">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !p ? (
        <LoadingState />
      ) : (
        <>
          <Card testID="rider.profile.card">
            <Text variant="display">{p.firstName + " " + p.lastName}</Text>
            <Text variant="bodySm" tone="text2">
              {p.phone}
            </Text>
          </Card>
          <Card>
            <Row label="Email" value={p.email} />
            <Row label="Status" value={p.status} />
            <Row label="Country" value={p.country ?? "—"} last />
          </Card>
          <Button
            testID="rider.profile.edit"
            label="Edit profile"
            kind="secondary"
            accessibilityLabel="Edit profile"
            onPress={() => nav.navigate("Edit")}
          />
        </>
      )}
      <Button
        testID="rider.profile.logout"
        label="Sign out"
        kind="danger"
        accessibilityLabel="Sign out"
        loading={loggingOut}
        onPress={() => {
          setLoggingOut(true);
          void authApi.logout().finally(() => {
            // Profile sits two navigators deep (Root > Main tabs > Account
            // stack), and `reset` never bubbles like `navigate` does — it
            // must be dispatched on the Root navigator itself.
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
