// D04 container — WalletHolds (Root screen). Total / held / spendable are three numbers
// the payment-service computed; the client renders them and NEVER derives one from the
// others. Top-ups stay "pending" until the wallet.topup.settled event clears them
// server-side — the UI never marks a top-up complete on its own.
import React from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Screen, Skeleton, Banner } from "@ubi/mobile-ui";
import { track, useCityConfig, useFlag } from "@ubi/mobile-core";
import type { RootStackParamList } from "../../navigation/routes";
import { marketplaceApi, type MpAdvanceBooking } from "../../api/marketplace";
import { WalletHoldsScreen, type WalletHold } from "./WalletHoldsScreen";

const UPCOMING = new Set(["payment_pending", "confirmed", "reconfirmed"]);
/** The earliest committed future booking (by the server's window start). */
export const nextBookingOf = (
  bookings: MpAdvanceBooking[],
): MpAdvanceBooking | null =>
  bookings
    .filter((b) => UPCOMING.has(b.state))
    .sort(
      (a, b) =>
        Date.parse(a.schedule.windowStart) - Date.parse(b.schedule.windowStart),
    )[0] ?? null;

export function WalletHoldsContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RootStackParamList, "WalletHolds">>();
  // `cityId` names the market whose currency/config applies (contract query param).
  const { config } = useCityConfig();
  const cityId = config?.cityId;
  const q = useQuery({
    queryKey: ["mp", "wallet", "overview", cityId ?? null],
    queryFn: () => marketplaceApi.walletOverview(cityId),
    refetchInterval: 5_000,
  });
  // A03: the next committed booking's net (only where advance bookings are on). A
  // calendar failure simply omits the row — the wallet figures never depend on it.
  const advanceOn = useFlag("marketplace_advance_reservations");
  const calQ = useQuery({
    queryKey: ["mp", "calendar"],
    queryFn: marketplaceApi.calendar,
    enabled: advanceOn,
    retry: false,
  });
  const next = advanceOn ? nextBookingOf(calQ.data?.bookings ?? []) : null;
  const topup = useMutation({
    mutationFn: (presetLabel: string) => marketplaceApi.topup(presetLabel),
    onSuccess: (_r, presetLabel) => {
      track("driver_mp_topup_started", { presetLabel });
      void q.refetch();
    },
  });
  if (q.isError) {
    return (
      <Screen title="Wallet" onBack={nav.goBack} bg="bg2">
        <Banner
          tone="error"
          title="Couldn’t load your wallet"
          body={(q.error as Error).message}
        />
      </Screen>
    );
  }
  const o = q.data;
  if (!o)
    return (
      <Screen title="Wallet" onBack={nav.goBack} bg="bg2">
        <Skeleton height={140} />
        <Skeleton height={180} />
      </Screen>
    );
  // Active holds only; released/captured rows belong to the statement ledger view.
  const holds: WalletHold[] = o.holds
    .filter((h) => h.state === "active" || h.state === "capture_pending")
    .map((h) => ({
      bidId: h.bidId,
      title: h.title ?? "Offer " + h.bidId,
      amountMinor: h.amountMinor,
      releaseCondition:
        h.releaseCondition ??
        "Releases when the requester decides or the request closes",
    }));
  const returnTo = params?.returnTo;
  return (
    <WalletHoldsScreen
      totalMinor={o.clearedMinor}
      heldMinor={o.heldMinor}
      spendableMinor={o.spendableMinor}
      holds={holds}
      shortfall={params?.shortfall ?? null}
      topupPresets={o.topupPresets ?? []}
      topups={o.topups ?? []}
      returnTo={
        returnTo
          ? {
              label: returnTo.label,
              onPress: () =>
                nav.navigate("Main", {
                  screen: "Requests",
                  params: {
                    screen: "Detail",
                    params: { requestId: returnTo.requestId },
                  },
                }),
            }
          : null
      }
      onTopUp={(preset) => topup.mutate(preset)}
      onBack={nav.goBack}
      nextBooking={
        next?.netMinor
          ? {
              windowLabel: next.schedule.label,
              netMinor: next.netMinor,
              onOpen: () => nav.navigate("Calendar"),
            }
          : null
      }
    />
  );
}
