// Main.Activity (C05 / G12, Phase 2): GET /v1/users/me/ride-history. This is
// the legacy (pre-marketplace) ride table — its fare fields are plain
// decimal strings/numbers in MAJOR units, not the marketplace's minor-unit
// Money shape, so they are formatted directly here rather than through
// MoneyText/formatMinor (which assume minor units and would misrender a
// legacy decimal by 100x). Nothing is computed — only what the server sent,
// shown as it was sent.
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen, Text, Card, Row, Button } from "@ubi/mobile-ui";
import { accountApi, type HistoryRide } from "../../api/account";
import { LoadingState, ErrorState, EmptyState } from "../../components/states";

function legacyFare(ride: HistoryRide): string {
  const raw = ride.finalFare ?? ride.estimatedFare;
  if (raw === null || raw === undefined) return "Not stated";
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (Number.isNaN(n)) return "Not stated";
  return (
    (ride.currency ?? "") +
    " " +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function driverLine(ride: HistoryRide): string | null {
  const name = ride.driver?.user;
  if (!name?.firstName && !name?.lastName) return null;
  return [name.firstName, name.lastName].filter(Boolean).join(" ");
}

export function ActivityScreen() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["account", "rideHistory", page],
    queryFn: () => accountApi.rideHistory(page, 20),
  });
  const d = q.data;
  return (
    <Screen title="Activity">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <LoadingState />
      ) : d.rides.length === 0 ? (
        <EmptyState
          title="No trips yet"
          body="Your completed and cancelled trips will show up here."
        />
      ) : (
        <>
          <Card>
            {d.rides.map((ride, i) => (
              <Row
                key={ride.id}
                testID="rider.activity.item"
                accessibilityLabel={
                  "Trip on " + new Date(ride.createdAt).toLocaleDateString()
                }
                last={i === d.rides.length - 1}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">
                    {ride.dropoffAddress ?? "Trip"}
                  </Text>
                  <Text variant="caption" tone="text2">
                    {new Date(ride.createdAt).toLocaleString()} · {ride.status}
                    {driverLine(ride) ? " · " + driverLine(ride) : ""}
                  </Text>
                </View>
                <Text variant="bodySmStrong" tabular>
                  {legacyFare(ride)}
                </Text>
              </Row>
            ))}
          </Card>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label="‹ Newer"
              kind="secondary"
              size="md"
              accessibilityLabel="Newer trips"
              disabled={page <= 1}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              style={{ flex: 1 }}
            />
            <Button
              label="Older ›"
              kind="secondary"
              size="md"
              accessibilityLabel="Older trips"
              disabled={page >= d.pagination.totalPages}
              onPress={() => setPage((p) => p + 1)}
              style={{ flex: 1 }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
