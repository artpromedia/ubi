// D02 + D03 + D10 container — Requests.Detail. The driver-view is a server projection:
// presets (gross / fee / net / shortfall) arrive phrased and are rendered VERBATIM — this
// container never computes money. Eligibility reasons[] map to the blocked state; myBid maps
// to the bid status card. Revising re-reserves server-side first: the client only shows the
// revising state and surfaces insufficient_spendable with the exact server shortfall plus a
// path to WalletHolds (with returnTo while the request is still open).
import React, { useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Screen, Skeleton, Banner, Button } from "@ubi/mobile-ui";
import { ApiError, formatMinor, track, type Money } from "@ubi/mobile-core";
import type {
  RequestsStackParamList,
  WalletHoldsParams,
} from "../../navigation/routes";
import { marketplaceApi, type MpPreset } from "../../api/marketplace";
import { useMotionGate } from "../../lib/motion";
import {
  RequestDetailScreen,
  type EligibilityReason,
} from "./RequestDetailScreen";

const mmss = (iso: string) => {
  const sec = Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 1000));
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
};
const LIVE_BID = new Set(["submitted", "revised", "selected_pending"]);

/**
 * A rejected submit/revise must SURFACE the server's message — never a silent
 * refetch. ApiError carries the server-phrased message verbatim; anything else
 * (network, unexpected shape) still gets an honest generic banner.
 */
export const bidRejection = (e: unknown): { title: string; detail: string } => {
  const message = e instanceof Error && e.message ? e.message : null;
  return {
    title: "Your offer wasn’t placed",
    detail:
      message ?? "Something went wrong — the request view has been refreshed.",
  };
};

export function RequestDetailContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RequestsStackParamList, "Detail">>();
  const gate = useMotionGate();
  const [choosingRevision, setChoosingRevision] = useState(false);
  const [spendErr, setSpendErr] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const [bidErr, setBidErr] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const q = useQuery({
    queryKey: ["mp", "driverView", params.requestId],
    queryFn: () => marketplaceApi.driverView(params.requestId),
    refetchInterval: 5_000,
    retry: false,
  });
  const view = q.data;

  const stillOpen = view ? Date.parse(view.item.expiresAt) > Date.now() : false;
  const toWallet = (shortfall: { title: string; detail: string } | null) => {
    const p: WalletHoldsParams = {
      ...(shortfall ? { shortfall } : {}),
      ...(stillOpen
        ? {
            returnTo: {
              requestId: params.requestId,
              label:
                "Back to request · still open " + mmss(view!.item.expiresAt),
            },
          }
        : {}),
    };
    nav.navigate("WalletHolds", p);
  };
  const onMoneyError = (e: unknown) => {
    if (e instanceof ApiError && e.code === "insufficient_spendable") {
      // Exact server phrasing — the client never re-derives the shortfall.
      setSpendErr({
        title: "Top-up needed to place this offer",
        detail: e.message,
      });
      return;
    }
    // Every other rejection SHOWS the server's message (queue_dependency_invalid,
    // version_conflict, request_closed, bid_not_live, NOT_STATIONARY…) — never a
    // silent refetch — and then re-fetches so the view underneath is current.
    setBidErr(bidRejection(e));
    void q.refetch();
  };
  const submit = useMutation({
    mutationFn: (preset: MpPreset) =>
      marketplaceApi.submitBid({
        requestId: params.requestId,
        requestRevision: view!.item.revision,
        amountMinor: preset.amountMinor,
        slot: view!.eligibility.slot ?? "current",
        // A next-slot bid must name the driver's current claim; driver-view's
        // currentClaimId is the server's own statement of it (the Jobs projection
        // is a display view, not the dependency source).
        ...(view!.eligibility.slot === "next" && view!.currentClaimId
          ? { dependsOnClaimId: view!.currentClaimId }
          : {}),
        availabilityEpoch: view!.eligibility.availabilityEpoch,
      }),
    onSuccess: (b) => {
      setSpendErr(null);
      setBidErr(null);
      track("driver_mp_bid_submitted", {
        requestId: params.requestId,
        bidId: b.bidId,
      });
      void q.refetch();
    },
    onError: onMoneyError,
  });
  const revise = useMutation({
    mutationFn: (p: {
      bidId: string;
      amountMinor: Money;
      expectedVersion: number;
    }) =>
      marketplaceApi.reviseBid(p.bidId, {
        amountMinor: p.amountMinor,
        expectedVersion: p.expectedVersion,
      }),
    onSuccess: (b) => {
      setSpendErr(null);
      setBidErr(null);
      track("driver_mp_bid_revised", { bidId: b.bidId, version: b.bidVersion });
      void q.refetch();
    },
    onError: onMoneyError,
  });
  const withdraw = useMutation({
    mutationFn: (bidId: string) => marketplaceApi.withdrawBid(bidId),
    onSuccess: (b) => {
      track("driver_mp_bid_withdrawn", { bidId: b.bidId });
      void q.refetch();
    },
    onError: () => {
      void q.refetch();
    },
  });

  if (q.isError) {
    const closed =
      q.error instanceof ApiError && q.error.code === "request_closed";
    return (
      <Screen title="Request" onBack={nav.goBack} bg="bg2">
        <Banner
          tone={closed ? "neutral" : "error"}
          title={
            closed ? "This request has closed" : "Couldn’t load this request"
          }
          body={(q.error as Error).message}
        />
        <Button
          label="Back to requests"
          kind="secondary"
          onPress={nav.goBack}
        />
      </Screen>
    );
  }
  if (!view)
    return (
      <Screen title="Request" onBack={nav.goBack} bg="bg2">
        <Skeleton height={120} />
        <Skeleton height={90} />
        <Skeleton height={220} />
      </Screen>
    );

  // Blocked state: the server's eligibility reasons verbatim (D10). If the local motion
  // gate says we're not parked while the server still evaluates eligible, bidding stays
  // hidden too — the client may only ever HIDE controls, never enable them (task C).
  const blocked: EligibilityReason[] | null = !view.eligibility.eligible
    ? view.eligibility.reasons
    : gate.motion !== "parked_confirmed"
      ? [
          gate.motion === "moving"
            ? {
                code: "NOT_STATIONARY",
                title: "You’re moving",
                detail:
                  "Offer controls stay hidden until you’re safely parked. The request stays in your feed.",
              }
            : {
                code: "LOCATION_STALE",
                title: "Location signal stale",
                detail:
                  "Bidding is paused until GPS recovers or you confirm you’re safely parked.",
              },
        ]
      : null;

  const myBidDto =
    view.myBid && LIVE_BID.has(view.myBid.state) ? view.myBid : null;
  const revising = choosingRevision && myBidDto !== null;
  const onPreset = (key: string) => {
    const preset = view.presets.find((c) => c.key === key);
    if (!preset) return;
    setBidErr(null);
    if (revising && myBidDto) {
      setChoosingRevision(false);
      revise.mutate({
        bidId: myBidDto.bidId,
        amountMinor: preset.amountMinor,
        expectedVersion: myBidDto.bidVersion,
      });
    } else {
      submit.mutate(preset);
    }
  };
  return (
    <RequestDetailScreen
      kind={view.item.service}
      // Privacy-limited server strings: "Lekki Phase 1 → Victoria Island" (exact addresses only after award).
      pickupArea={view.item.title.split(" → ")[0] ?? view.item.title}
      dropoffArea={view.item.title.split(" → ")[1] ?? ""}
      meta={view.item.meta}
      askedMinor={view.item.askedMinor}
      profileLine={view.profileLine ?? null}
      ceilingNotice={view.ceilingNotice ?? null}
      earnings={view.item.earnings ?? null}
      preferenceNotice={view.preferenceNotice ?? null}
      presets={view.presets.map((c) => ({
        key: c.key,
        title: c.title,
        feeNetLabel: c.feeNetLabel,
        affordable: c.affordable,
        shortfallLabel: c.shortfallLabel,
        emphasized: c.emphasized,
        earnings: c.earnings ?? null,
      }))}
      onBid={onPreset}
      // The custom-amount composer is not part of this handoff slice (presets only);
      // honest unavailability: the button is not rendered rather than shipped dead. See followups.
      stationary={false}
      onCustom={() => {}}
      onSkip={() => {
        track("driver_mp_request_skipped", { requestId: params.requestId });
        nav.goBack();
      }}
      onTopUp={() => {
        const short = view.presets.find(
          (c) => !c.affordable && c.shortfallLabel,
        );
        toWallet(
          short?.shortfallLabel
            ? {
                title: "Top-up needed to place this offer",
                detail: short.shortfallLabel,
              }
            : null,
        );
      }}
      blocked={blocked}
      myBid={
        myBidDto && !revising
          ? {
              version: myBidDto.bidVersion,
              amountMinor: myBidDto.amountMinor,
              // Formatting only (launch CLAUDE.md #1): both amounts are server minor units.
              holdLabel: formatMinor(myBidDto.commissionMinor) + " held",
              netLabel: formatMinor(myBidDto.netMinor),
              closesLabel: mmss(myBidDto.expiresAt),
              revising: revise.isPending || submit.isPending,
              onRevise: () => setChoosingRevision(true),
              onWithdraw: () => withdraw.mutate(myBidDto.bidId),
            }
          : null
      }
      spendableError={
        spendErr
          ? {
              ...spendErr,
              walletLabel: "Top up in Wallet",
              onWallet: () => toWallet(spendErr),
            }
          : null
      }
      bidError={bidErr}
    />
  );
}
