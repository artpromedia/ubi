// A03 container — Marketplace.Schedule. Prices the trip with the same quote key the route
// builder / fare editor use (a live envelope is reused, never re-priced silently), then
// creates ONE of three products with a caller-held Idempotency-Key:
//   POST /v1/mp/scheduled-requests  (scheduled_rides)                → Scheduled detail
//   POST /v1/mp/advance-requests    (marketplace_advance_reservations) → advance offers
//   POST /v1/mp/recurring-templates (marketplace_recurring_journeys)  → Series detail
// The schedule is local date + local time + IANA timezone (+ window); the server resolves
// the instant and DST. Typed amounts are packaged by lib/moneyInput only; every bound is
// the server's and every refusal keeps the server's words.
import React, { useEffect, useRef, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  formatMinor,
  track,
  useCityConfig,
  useFlag,
  useFlags,
  type Money,
} from "@ubi/mobile-core";
import {
  MpLocalDateSchema,
  MpLocalTimeSchema,
  type MpCreateRecurringTemplate,
  type MpPickupScheduleInput,
} from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import { marketplaceApi } from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { typedDigits, typedMajorToMoney } from "../../lib/moneyInput";
import { forgetQuote } from "../../lib/quoteCache";
import { ScheduleRideScreen, type ScheduleProduct } from "./ScheduleRideScreen";
import {
  STOP_PURPOSE_TEXT,
  WEEKDAYS,
  isOffline,
  km,
  minutes,
  refusalFor,
  type Refusal,
} from "./riderCopy";
import type { RoutePoint } from "./riderParts";

/** The payment method the marketplace publishes with (same as the fare editor). */
const PAYMENT_METHOD_ID = "pm_wallet";

const WINDOW_CHOICES: { label: string; minutes: number | undefined }[] = [
  { label: "Standard window", minutes: undefined },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "45 min", minutes: 45 },
];

/** YYYY-MM-DD `offsetDays` from today in `timeZone` (device-local when unknown). */
export const localDateIn = (offsetDays: number, timeZone?: string) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  try {
    // formatToParts is locale-order independent (Hermes may lack en-CA's ISO order).
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(d);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    const [y, m, day] = [part("year"), part("month"), part("day")];
    if (y && m && day) return y + "-" + m + "-" + day;
  } catch {
    // Fall through to the device-local date.
  }
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

const NO_DRIVER: Record<ScheduleProduct, string> = {
  scheduled:
    "This is a scheduled request. We store it now and send it to drivers shortly before your pickup. No driver is secured until you choose one of their offers.",
  advance:
    "Drivers offer now on your future pickup window. No driver is secured until you choose one of their offers — then that driver is reserved for this trip.",
  series:
    "Each trip in the series is booked on its own. Setting up the series doesn’t secure any driver; every trip shows its own status.",
};

const TERMS: Record<ScheduleProduct, string[]> = {
  scheduled: [
    "Free to cancel before it’s sent to drivers.",
    "If the fare range moves above what you approve, we ask you before sending it.",
    "Nothing is reserved or charged until you choose a driver.",
  ],
  advance: [
    "Offers stay open for a limited time; nothing is charged while you compare them.",
    "Once you choose a driver, cancelling before the trip starts is free.",
    "If your driver can’t make it, we explain what happened and you decide whether to look for another driver.",
  ],
  series: [
    "Skip any single trip, or pause or cancel the series at any time.",
    "Each trip has its own fare approval, driver and receipt.",
    "Trips already sent to drivers stand on their own if you cancel the series.",
  ],
};

export function ScheduleRideContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "Schedule">>();
  const qp = params.quoteParams;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("later");
  const { status: flagStatus } = useFlags();
  const scheduledOn = useFlag("scheduled_rides");
  const advanceOn = useFlag("marketplace_advance_reservations");
  const seriesFlag = useFlag("marketplace_recurring_journeys");
  const seriesOn = seriesFlag && (scheduledOn || advanceOn);
  const { config } = useCityConfig();
  const timeZone = config?.timezone;
  const anyOn = scheduledOn || advanceOn || seriesOn;

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
        stops: qp.stops,
      }),
    enabled: anyOn,
    retry: false,
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
  const quote = q.data;

  const products: { code: ScheduleProduct; label: string; detail: string }[] = [
    ...(scheduledOn
      ? [
          {
            code: "scheduled" as const,
            label: "Schedule a request",
            detail: "Offers open shortly before pickup.",
          },
        ]
      : []),
    ...(advanceOn
      ? [
          {
            code: "advance" as const,
            label: "Reserve a driver now",
            detail: "Drivers offer now for your future pickup window.",
          },
        ]
      : []),
    ...(seriesOn
      ? [
          {
            code: "series" as const,
            label: "Repeat on set days",
            detail: "A recurring journey — each trip books on its own.",
          },
        ]
      : []),
  ];
  const seriesProducts = [
    ...(scheduledOn
      ? [{ code: "scheduled_request" as const, label: "Scheduled requests" }]
      : []),
    ...(advanceOn
      ? [{ code: "advance_reservation" as const, label: "Reserved drivers" }]
      : []),
  ];
  const [product, setProduct] = useState<ScheduleProduct | null>(null);
  const active: ScheduleProduct = product ?? products[0]?.code ?? "scheduled";
  const [seriesProduct, setSeriesProduct] = useState<
    "scheduled_request" | "advance_reservation" | null
  >(null);
  const activeSeriesProduct =
    seriesProduct ?? seriesProducts[0]?.code ?? "scheduled_request";
  const [date, setDate] = useState(() => localDateIn(1, timeZone));
  const [time, setTime] = useState("");
  const [windowMinutes, setWindowMinutes] = useState<number | undefined>(
    undefined,
  );
  const [days, setDays] = useState<string[]>([]);
  const [endsOn, setEndsOn] = useState("");
  // An amount is either one of the server's own figures (a chip — used exactly as served)
  // or digits the rider typed (packaged by lib/moneyInput). Never both, never converted back.
  const [fareRaw, setFareRaw] = useState("");
  const [fare, setFare] = useState<Money | null>(null);
  const [fareChip, setFareChip] = useState<string | null>(null);
  const [maxRaw, setMaxRaw] = useState("");
  const [maxFare, setMaxFare] = useState<Money | null>(null);
  const [maxChip, setMaxChip] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Seed the asked fare and the approval from the FIRST quote's own figures. A later quote
  // (an expired one re-priced) never moves the rider's choices silently: typed amounts
  // stay exactly as typed, and a figure picked from the old quote's chips is cleared so
  // the rider chooses again against the new figures — the most they approve is never
  // widened without them.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!quote || seededFor.current === quote.quoteId) return;
    const first = seededFor.current === null;
    seededFor.current = quote.quoteId;
    if (first) {
      setFare(quote.suggestedFareMinor);
      setFareChip("suggested");
      setFareRaw("");
      setMaxFare(quote.maximumFareMinor);
      setMaxChip("maximum");
      setMaxRaw("");
      return;
    }
    if (fareChip) {
      setFare(null);
      setFareChip(null);
    }
    if (maxChip) {
      setMaxFare(null);
      setMaxChip(null);
    }
    if (fareChip || maxChip)
      setFieldError(
        "The price was updated — choose your fare and the most you approve again.",
      );
    // Runs once per server quote (a refetch of the same quote must not reset choices).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.quoteId]);

  const create = useMutation({
    mutationFn: async (v: {
      kind: ScheduleProduct;
      body: unknown;
      quoteId: string;
      print: string;
    }) => {
      const key = keys.keyFor(v.print);
      if (v.kind === "scheduled") {
        const sr = await marketplaceApi.createScheduled(
          v.body as Parameters<typeof marketplaceApi.createScheduled>[0],
          key,
        );
        return { kind: v.kind, id: sr.scheduledRequestId };
      }
      if (v.kind === "advance") {
        const r = await marketplaceApi.createAdvance(
          v.body as Parameters<typeof marketplaceApi.createAdvance>[0],
          key,
        );
        return { kind: v.kind, id: r.requestId };
      }
      const s = await marketplaceApi.createSeries(
        v.body as MpCreateRecurringTemplate,
        key,
      );
      return { kind: v.kind, id: s.templateId };
    },
    onSuccess: (res, v) => {
      keys.settle(v.print);
      // An advance request CONSUMES its quote (a scheduled intent or series only pins
      // it): either way a later visit prices afresh rather than reusing this envelope.
      forgetQuote(queryClient, v.quoteId);
      track("mp_later_created", { product: res.kind });
      if (res.kind === "scheduled")
        nav.navigate("Scheduled", { scheduledRequestId: res.id });
      else if (res.kind === "advance")
        nav.navigate("AdvanceOffers", { requestId: res.id });
      else nav.navigate("Series", { templateId: res.id });
    },
    onError: (e, v) => {
      keys.settle(v.print, e);
      if (e instanceof ApiError && e.code === "quote_expired") void q.refetch();
      setRefusal(refusalFor(e));
    },
  });

  const now = () => nav.navigate("Fare", { quoteParams: qp });
  const stopsCount = quote?.stops?.length ?? qp.stops?.length ?? 0;
  const route: RoutePoint[] = [
    { key: "pickup", kind: "pickup", label: qp.pickup.label },
    ...(quote?.stops ?? []).map(
      (s): RoutePoint => ({
        key: s.stopId,
        kind: "stop",
        label: s.label,
        detail: STOP_PURPOSE_TEXT[s.purpose] ?? "Stop",
      }),
    ),
    { key: "dropoff", kind: "dropoff", label: qp.dropoff.label },
  ];
  const fareChips = quote
    ? [
        {
          key: "suggested",
          label: "Suggested · " + formatMinor(quote.suggestedFareMinor),
          money: quote.suggestedFareMinor,
        },
        {
          key: "minimum",
          label: "Minimum · " + formatMinor(quote.minimumFareMinor),
          money: quote.minimumFareMinor,
        },
      ]
    : [];
  const maxChips = quote
    ? [
        {
          key: "maximum",
          label: "Up to the maximum · " + formatMinor(quote.maximumFareMinor),
          money: quote.maximumFareMinor,
        },
        {
          key: "suggested",
          label:
            "Up to the suggestion · " + formatMinor(quote.suggestedFareMinor),
          money: quote.suggestedFareMinor,
        },
      ]
    : [];

  const validate = (): string | null => {
    if (!MpLocalDateSchema.safeParse(date).success)
      return "Enter the date as YYYY-MM-DD.";
    if (!MpLocalTimeSchema.safeParse(time).success)
      return "Enter the pickup time as HH:MM (24-hour), e.g. 07:30.";
    if (active === "series") {
      if (days.length === 0) return "Choose at least one day to repeat on.";
      if (endsOn.trim() && !MpLocalDateSchema.safeParse(endsOn.trim()).success)
        return "Enter the end date as YYYY-MM-DD, or leave it empty.";
    }
    if (!fare) return "Enter the fare you want to ask.";
    if (active !== "advance" && !maxFare) return "Enter the most you approve.";
    return null;
  };

  const onSubmit = () => {
    if (!quote) return;
    setRefusal(null);
    const problem = validate();
    setFieldError(problem);
    if (problem || !fare) return;
    const schedule: MpPickupScheduleInput = {
      localDate: date,
      localTime: time,
      ...(timeZone ? { timeZone } : {}),
      ...(windowMinutes !== undefined ? { windowMinutes } : {}),
    };
    let body: unknown;
    if (active === "scheduled")
      body = {
        quoteId: quote.quoteId,
        requestedFareMinor: fare,
        maxFareMinor: maxFare,
        paymentMethodId: PAYMENT_METHOD_ID,
        schedule,
      };
    else if (active === "advance")
      body = {
        quoteId: quote.quoteId,
        requestedFareMinor: fare,
        paymentMethodId: PAYMENT_METHOD_ID,
        schedule,
      };
    else
      body = {
        quoteId: quote.quoteId,
        product: activeSeriesProduct,
        daysOfWeek: WEEKDAYS.map((d) => d.code).filter((c) => days.includes(c)),
        localTime: time,
        ...(timeZone ? { timeZone } : {}),
        startsOn: date,
        ...(endsOn.trim() ? { endsOn: endsOn.trim() } : {}),
        ...(windowMinutes !== undefined ? { windowMinutes } : {}),
        requestedFareMinor: fare,
        maxFareMinor: maxFare,
        paymentMethodId: PAYMENT_METHOD_ID,
      };
    create.mutate({
      kind: active,
      body,
      quoteId: quote.quoteId,
      print: active + ":" + JSON.stringify(body),
    });
  };

  return (
    <ScheduleRideScreen
      loading={flagStatus === "loading" || (anyOn && q.isPending)}
      loadFailure={
        anyOn && q.isError
          ? {
              offline: isOffline(q.error),
              body:
                q.error instanceof ApiError &&
                q.error.code === "market_not_configured"
                  ? "The fare marketplace isn’t set up for this route yet."
                  : refusalFor(q.error).body,
              onRetry: () => void q.refetch(),
            }
          : null
      }
      unavailable={anyOn ? null : { onNow: now }}
      products={products}
      product={active}
      onProduct={(p) => {
        setProduct(p);
        setRefusal(null);
        setFieldError(null);
      }}
      route={route}
      routeSummary={
        quote
          ? km(quote.routedDistanceMeters) +
            " · about " +
            minutes(quote.routedDurationSec) +
            (stopsCount
              ? " · " + stopsCount + (stopsCount === 1 ? " stop" : " stops")
              : "")
          : ""
      }
      bounds={
        quote
          ? {
              minimum: quote.minimumFareMinor,
              suggested: quote.suggestedFareMinor,
              maximum: quote.maximumFareMinor,
            }
          : null
      }
      timeZoneLabel={
        timeZone
          ? "Times are local to the pickup (" + timeZone + ")."
          : "Times are local to the pickup city."
      }
      date={date}
      onDate={(v) => {
        setDate(v.trim());
        setFieldError(null);
      }}
      dateChips={[
        { label: "Today", value: localDateIn(0, timeZone) },
        { label: "Tomorrow", value: localDateIn(1, timeZone) },
        { label: "In 2 days", value: localDateIn(2, timeZone) },
      ]}
      time={time}
      onTime={(v) => {
        setTime(v.trim());
        setFieldError(null);
      }}
      windowChoices={WINDOW_CHOICES}
      windowMinutes={windowMinutes}
      onWindow={setWindowMinutes}
      days={
        active === "series"
          ? WEEKDAYS.map((d) => ({
              code: d.code,
              label: d.label,
              selected: days.includes(d.code),
            }))
          : null
      }
      onToggleDay={(code) =>
        setDays((list) =>
          list.includes(code)
            ? list.filter((c) => c !== code)
            : [...list, code],
        )
      }
      endsOn={endsOn}
      onEndsOn={setEndsOn}
      seriesProducts={seriesProducts}
      seriesProduct={activeSeriesProduct}
      onSeriesProduct={setSeriesProduct}
      fareRaw={fareRaw}
      fareSelected={fare}
      onFare={(v) => {
        const digits = typedDigits(v);
        setFareRaw(digits);
        setFareChip(null);
        setFare(quote ? typedMajorToMoney(digits, quote.currency) : null);
        setFieldError(null);
      }}
      fareChips={fareChips}
      fareChip={fareChip}
      onFareChip={(key) => {
        const chip = fareChips.find((c) => c.key === key);
        if (!chip) return;
        setFare(chip.money);
        setFareChip(key);
        setFareRaw("");
        setFieldError(null);
      }}
      maxFare={
        active === "advance"
          ? null
          : {
              raw: maxRaw,
              selected: maxFare,
              onChange: (v) => {
                const digits = typedDigits(v);
                setMaxRaw(digits);
                setMaxChip(null);
                setMaxFare(
                  quote ? typedMajorToMoney(digits, quote.currency) : null,
                );
                setFieldError(null);
              },
              chips: maxChips,
              chip: maxChip,
              onChip: (key) => {
                const chip = maxChips.find((c) => c.key === key);
                if (!chip) return;
                setMaxFare(chip.money);
                setMaxChip(key);
                setMaxRaw("");
                setFieldError(null);
              },
            }
      }
      noDriverCopy={NO_DRIVER[active]}
      terms={TERMS[active]}
      fieldError={fieldError}
      refusal={refusal}
      submitLabel={
        active === "scheduled"
          ? "Save scheduled request"
          : active === "advance"
            ? "Ask drivers for offers"
            : "Save recurring journey"
      }
      canSubmit={!!quote && !create.isPending}
      busy={create.isPending}
      onSubmit={onSubmit}
      onBack={nav.goBack}
    />
  );
}
