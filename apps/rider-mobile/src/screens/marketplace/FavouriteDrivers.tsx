// A04 item 3 — Marketplace.Favourites: the drivers the rider saved after completed trips. The
// list is ALWAYS readable (whatever the flag says), so a rider can always see — and remove —
// what is stored about their choices. Each driver shows the verified card as served and
// whether they can be asked first right now (why not is deliberately not said). Saving
// happens from a completed trip's receipt; asking first happens when setting a fare, with an
// explicit choice of what happens if they don't offer. Favouriting never guarantees
// availability or bypasses eligibility, pricing or the driver's own choice.
import React, { useState } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, Card, Screen, Text } from "@ubi/mobile-ui";
import { track, useFlag } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import {
  marketplaceApi,
  type MpFavouriteDriver,
  type MpFavouriteDrivers,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { isOffline, refusalFor, whenLabel, type Refusal } from "./riderCopy";
import { LoadFailure, LoadingBlocks, StateTag } from "./riderParts";

const TID = TEST_IDS.mp.rider.favourites;

export type FavouriteRow = {
  driverId: string;
  name: string;
  statusLabel: string;
  verified: boolean;
  ratingLabel: string;
  canRequest: boolean;
  canRequestLabel: string;
  savedLabel: string;
  removing: boolean;
  onRemove: () => void;
};

export type FavouriteDriversProps = {
  loading: boolean;
  failure: { offline: boolean; body: string; onRetry: () => void } | null;
  rows: FavouriteRow[];
  note: string | null;
  askFirstOn: boolean;
  refusal: Refusal | null;
  removed: string | null;
  onBook: (() => void) | null;
  onBack: () => void;
};

export function FavouriteDriversView(p: FavouriteDriversProps) {
  return (
    <Screen
      title="Saved drivers"
      subtitle="Ask them first — never a guarantee"
      onBack={p.onBack}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        {p.loading ? (
          <LoadingBlocks heights={[80, 80]} />
        ) : p.failure ? (
          <LoadFailure
            offline={p.failure.offline}
            title="Couldn’t load your saved drivers"
            body={p.failure.body}
            onRetry={p.failure.onRetry}
            testIDs={TID}
          />
        ) : (
          <>
            <Banner
              testID={TID.note}
              tone="info"
              body={
                (p.note ? p.note + " " : "") +
                (p.askFirstOn
                  ? "When you set a fare you can ask one of them first. They get a short window to offer under the same fare rules, and you choose what happens if they don’t."
                  : "Asking a saved driver first isn’t available in your city right now. You can still see and remove the drivers you saved.")
              }
            />
            {p.removed ? <Banner tone="ok" body={p.removed} /> : null}
            {p.refusal ? (
              <Banner
                testID={TID.refusal}
                tone="error"
                title={p.refusal.title}
                body={p.refusal.body}
              />
            ) : null}
            {p.rows.length === 0 ? (
              <Card testID={TID.empty} style={{ gap: 4 }}>
                <Text variant="bodyStrong">No saved drivers</Text>
                <Text variant="bodySm" tone="text2">
                  After a completed trip, open its receipt to save the driver.
                </Text>
              </Card>
            ) : null}
            {p.rows.map((r) => (
              <Card
                key={r.driverId}
                testID={dynamicTestId(TID.item, r.driverId)}
                style={{ gap: 6 }}
              >
                <Text variant="bodyStrong">{r.name}</Text>
                <StateTag
                  label={r.statusLabel}
                  tone={r.verified ? "ok" : "neutral"}
                />
                <Text variant="caption" tone="text2">
                  {r.ratingLabel + " · " + r.savedLabel}
                </Text>
                <StateTag
                  testID={dynamicTestId(TID.canRequest, r.driverId)}
                  label={r.canRequestLabel}
                  tone={r.canRequest ? "info" : "neutral"}
                />
                <Button
                  testID={dynamicTestId(TID.remove, r.driverId)}
                  label="Remove"
                  kind="ghost"
                  size="md"
                  loading={r.removing}
                  onPress={r.onRemove}
                />
              </Card>
            ))}
            {p.onBook ? (
              <Button
                testID={TID.book}
                label="Book a ride"
                onPress={p.onBook}
              />
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

export function FavouriteDriversContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const askFirstOn = useFlag("marketplace_preferred_drivers");
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("fav");
  const q = useQuery({
    queryKey: ["mp", "favourites"],
    queryFn: marketplaceApi.favourites,
    retry: false,
  });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (f: MpFavouriteDriver) =>
      marketplaceApi.removeFavourite(
        f.driverId,
        keys.keyFor("remove:" + f.driverId),
      ),
    onSuccess: (res, f) => {
      keys.settle("remove:" + f.driverId);
      track("mp_favourite_removed", {});
      setRefusal(null);
      setRemoved(
        (f.driverProfile.displayName ?? f.driver.displayName) +
          " was removed from your saved drivers.",
      );
      queryClient.setQueryData<MpFavouriteDrivers>(
        ["mp", "favourites"],
        (old) =>
          old
            ? {
                ...old,
                items: old.items.map((i) =>
                  i.driverId === res.driverId ? res : i,
                ),
              }
            : old,
      );
    },
    onError: (e, f) => {
      keys.settle("remove:" + f.driverId, e);
      setRemoved(null);
      setRefusal(refusalFor(e));
    },
  });
  const items = (q.data?.items ?? []).filter((i) => i.state === "active");
  const rows: FavouriteRow[] = items.map((f) => ({
    driverId: f.driverId,
    name:
      f.driverProfile.status !== "unavailable" && f.driverProfile.displayName
        ? f.driverProfile.displayName
        : "Driver details unavailable",
    statusLabel: f.driverProfile.label,
    verified: f.driverProfile.status === "verified",
    ratingLabel: f.driverProfile.ratingLabel,
    canRequest: f.canRequest,
    canRequestLabel: f.canRequestLabel,
    savedLabel: "Saved " + whenLabel(f.savedAt),
    removing: remove.isPending && remove.variables?.driverId === f.driverId,
    onRemove: () => remove.mutate(f),
  }));
  return (
    <FavouriteDriversView
      loading={q.isPending}
      failure={
        q.isError && !q.data
          ? {
              offline: isOffline(q.error),
              body: (q.error as Error).message,
              onRetry: () => void q.refetch(),
            }
          : null
      }
      rows={rows}
      note={q.data?.note ?? null}
      askFirstOn={askFirstOn}
      refusal={refusal}
      removed={removed}
      onBook={
        askFirstOn && items.some((i) => i.canRequest)
          ? () => nav.navigate("Details")
          : null
      }
      onBack={nav.goBack}
    />
  );
}
