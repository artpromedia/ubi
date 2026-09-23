// R02 + R03 container — Marketplace.Fare. The server owns bounds and validation: the quote
// envelope is rendered verbatim, the typed amount is only packaged (major digits → minor units,
// quote currency) and every rejection (fare_out_of_bounds, market_not_configured) is shown
// with the server's own message. Publish → Offers with the server's requestId.
//
// Rides also carry the booking options (BookingOptions.tsx): a saved driver asked first with the
// rider's explicit fallback choice, service needs, a passenger for another adult, and an
// organization payer — each behind its own flag, each re-validated by the server, and each
// refusal (service_need_unavailable, minors, no budget, outside policy…) stated plainly. A
// business payer asks the quote route for the organization's ADVISORY policy verdict in a
// separate read (the fare editor keeps its own quote; the publish is re-checked server-side).
// The publish carries a caller-held Idempotency-Key: a retry replays, it never publishes twice.
import React, { useEffect, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen, Banner, Button, Skeleton } from "@ubi/mobile-ui";
import { ApiError, formatMinor, track, type Money } from "@ubi/mobile-core";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import { marketplaceApi } from "../../api/marketplace";
import { forgetQuote } from "../../lib/quoteCache";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { FareEditorScreen } from "./FareEditorScreen";
import {
  BookingOptions,
  EMPTY_BOOKING_OPTIONS,
  businessQuoteParams,
  publishExtrasOf,
  useBookingOptionFlags,
  type BookingOptionsState,
} from "./BookingOptions";
import { publishRefusal } from "./confidenceCopy";

const majorToMoney = (raw: string, currency: string): Money => ({
  amountMinor: (parseInt(raw.replace(/\D/g, ""), 10) || 0) * 100,
  currency,
});

// Runtime guard: money fields must be contract Money objects ({amountMinor, currency}).
// A malformed envelope (e.g. a bare integer) must never seed the editor — it would render 'NaN'.
const isMoney = (m: unknown): m is Money =>
  !!m &&
  typeof m === "object" &&
  Number.isFinite((m as Money).amountMinor) &&
  typeof (m as Money).currency === "string";

export function FareEditorContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, "Fare">>();
  const qp = params.quoteParams;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("publish");
  const isRide = qp.service === "ride";
  const allFlags = useBookingOptionFlags();
  // Booking options apply to rides only (deliveries stay single-sender, single-payer).
  const flags = isRide
    ? allFlags
    : { preferred: false, needs: false, guest: false, business: false };
  const [options, setOptions] = useState<BookingOptionsState>(
    EMPTY_BOOKING_OPTIONS,
  );
  const [showOptionErrors, setShowOptionErrors] = useState(false);
  const bq = businessQuoteParams(options, flags);
  const q = useQuery({
    queryKey: ["mp", "quote", qp],
    queryFn: () =>
      marketplaceApi.quote({
        service: qp.service,
        vehicleClass: qp.vehicleClass,
        pickupLat: qp.pickup.lat,
        pickupLng: qp.pickup.lng,
        dropoffLat: qp.dropoff.lat,
        dropoffLng: qp.dropoff.lng,
        weightKg: qp.weightKg,
        // A02: a multi-stop route (from the route builder) is priced as ONE ordered route.
        stops: qp.stops,
      }),
    retry: false,
    // A quote stays fresh until shortly before its own server expiry, so the envelope the
    // route builder just showed (seeded into this very key) is the one published.
    staleTime: (query) => {
      const expires = Date.parse(
        (query.state.data as { expiresAt?: string } | undefined)?.expiresAt ??
          "",
      );
      return Number.isFinite(expires)
        ? Math.max(0, expires - Date.now() - 15_000)
        : 0;
    },
  });
  // Treat an envelope whose money fields aren't valid contract Money objects as not yet
  // loaded: the skeleton stays up and nothing NaN can ever be seeded or rendered.
  const raw = q.data;
  const quote =
    raw &&
    isMoney(raw.suggestedFareMinor) &&
    isMoney(raw.minimumFareMinor) &&
    isMoney(raw.maximumFareMinor)
      ? raw
      : undefined;
  const [expired, setExpired] = useState(false);
  const [amountRaw, setAmountRaw] = useState("");
  const [amount, setAmount] = useState<Money | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  // Seed the editable amount from the server suggestion once per quote.
  useEffect(() => {
    if (!quote) return;
    setExpired(false);
    setFieldError(null);
    setAmountRaw(
      String(Math.round(quote.suggestedFareMinor.amountMinor / 100)),
    );
    setAmount(quote.suggestedFareMinor);
    const ms = Date.parse(quote.expiresAt) - Date.now();
    const timer = setTimeout(() => setExpired(true), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [quote?.quoteId]);
  // The organization's advisory verdict (quote with organizationId): its own read, so a
  // refused or unanswered check never replaces the fare being edited.
  const businessQ = useQuery({
    queryKey: ["mp", "quote", qp, bq],
    queryFn: () =>
      marketplaceApi.quote({
        service: qp.service,
        vehicleClass: qp.vehicleClass,
        pickupLat: qp.pickup.lat,
        pickupLng: qp.pickup.lng,
        dropoffLat: qp.dropoff.lat,
        dropoffLng: qp.dropoff.lng,
        stops: qp.stops,
        ...bq,
      }),
    enabled: !!bq.organizationId,
    retry: false,
  });
  // The verdict is taken at the quote's suggested fare: say whether that is the fare being sent
  // (an equality check of two amounts as served / typed — nothing is computed).
  const checked = businessQ.data?.business?.checkedAmountMinor;
  const sending = amount ?? quote?.suggestedFareMinor;
  const businessCheck = bq.organizationId
    ? {
        check: businessQ.data?.business,
        error: businessQ.isError ? businessQ.error : null,
        checking: businessQ.isPending,
        checkedAtRequestedFare:
          !checked ||
          !sending ||
          (checked.currency === sending.currency &&
            checked.amountMinor === sending.amountMinor),
      }
    : undefined;
  const extras = publishExtrasOf(options, flags, businessCheck);
  const publish = useMutation({
    mutationFn: (v: { body: Parameters<typeof marketplaceApi.publish>[0] }) =>
      marketplaceApi.publish(v.body, keys.keyFor(JSON.stringify(v.body))),
    onSettled: (_r, e, v) =>
      keys.settle(JSON.stringify(v.body), e ?? undefined),
    onSuccess: (r) => {
      // Publishing CONSUMED the quote: never offer the spent envelope to a later visit.
      forgetQuote(queryClient, r.quoteId);
      track("mp_request_published", {
        requestId: r.requestId,
        service: r.service,
      });
      setReviewVisible(false);
      nav.navigate("Offers", { requestId: r.requestId });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "fare_out_of_bounds") {
        setFieldError(e.message);
        setReviewVisible(false);
      }
      if (e instanceof ApiError && e.code === "quote_expired") {
        setExpired(true);
        setReviewVisible(false);
      }
    },
  });
  const send = () => {
    if (!quote) return;
    if (extras.problems.length) {
      setShowOptionErrors(true);
      return;
    }
    publish.mutate({
      body: {
        quoteId: quote.quoteId,
        requestedFareMinor: amount ?? quote.suggestedFareMinor,
        ...extras.body,
        ...(qp.service === "delivery" && qp.weightKg !== undefined
          ? { delivery: { weightKg: qp.weightKg, handling: qp.handling ?? [] } }
          : {}),
      },
    });
  };
  if (q.isError) {
    const notConfigured =
      q.error instanceof ApiError && q.error.code === "market_not_configured";
    return (
      <Screen title="Set your fare" onBack={nav.goBack}>
        <Banner
          tone={notConfigured ? "neutral" : "error"}
          title={
            notConfigured
              ? "Not available here yet"
              : "Couldn’t price this trip"
          }
          body={
            notConfigured
              ? "The fare marketplace isn’t configured for this route yet."
              : (q.error as Error).message
          }
        />
        <Button label="Back" kind="secondary" onPress={nav.goBack} />
      </Screen>
    );
  }
  if (!quote)
    return (
      <Screen title="Set your fare" onBack={nav.goBack}>
        <Skeleton height={220} />
        <Skeleton height={120} />
      </Screen>
    );
  const publishError =
    publish.isError &&
    !fieldError &&
    !(
      publish.error instanceof ApiError &&
      publish.error.code === "quote_expired"
    )
      ? publishRefusal(publish.error)
      : null;
  const belowSuggestion =
    amount !== null &&
    amount.amountMinor < quote.suggestedFareMinor.amountMinor;
  return (
    <FareEditorScreen
      quote={quote}
      quoteState={expired ? "expired" : "live"}
      amountRaw={amountRaw}
      amountMinor={amount ?? quote.suggestedFareMinor}
      onAmountChange={(raw) => {
        const digits = raw.replace(/\D/g, "");
        setAmountRaw(digits);
        setAmount(majorToMoney(digits, quote.currency));
        setFieldError(null);
      }}
      fieldError={fieldError}
      belowSuggestionHint={
        belowSuggestion
          ? "Below the suggestion — fewer drivers usually answer."
          : null
      }
      presets={[
        {
          label: "Suggested · " + formatMinor(quote.suggestedFareMinor),
          amountMinor: quote.suggestedFareMinor,
        },
      ]}
      onPresetSelect={(m) => {
        setAmountRaw(String(Math.round(m.amountMinor / 100)));
        setAmount(m);
        setFieldError(null);
      }}
      onRefreshQuote={() => {
        void q.refetch();
      }}
      onReview={() => {
        publish.reset();
        if (extras.problems.length) setShowOptionErrors(true);
        setReviewVisible(true);
      }}
      onBack={nav.goBack}
      options={
        <BookingOptions
          state={options}
          onChange={(next) => {
            setOptions(next);
            publish.reset();
          }}
          vehicleClass={qp.vehicleClass}
          flags={flags}
          businessCheck={businessCheck}
          showErrors={showOptionErrors}
        />
      }
      review={{
        visible: reviewVisible,
        payment: extras.paymentLabel,
        cancellation: "Free to cancel until you choose an offer",
        publishing: publish.isPending,
        publishError,
        lines: extras.summary,
        problems: extras.problems,
        onSend: send,
        onEdit: () => setReviewVisible(false),
        onDismiss: () => setReviewVisible(false),
      }}
    />
  );
}
