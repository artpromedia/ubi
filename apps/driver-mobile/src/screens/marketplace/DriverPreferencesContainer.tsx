// A04.2 container — Preferences (Root screen). GET /v1/mp/driver/preferences seeds an
// editable draft once per saved version; Save sends PATCH with ONLY the changed fields and
// the version it was read at (expectedVersion), under an Idempotency-Key held until that
// exact change lands — a retry after a dropped response replays instead of writing twice.
// States: loading (skeleton), error (server message verbatim + retry), offline (last
// server copy stays readable; nothing is claimed saved), conflict (409: reloaded from the
// server, the driver reviews again). Bounds and option lists come from the server view;
// the client never filters the feed or bids from these values.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentPosition } from "react-native-geolocation-service";
import { Screen, Skeleton, Banner, Button } from "@ubi/mobile-ui";
import { ApiError, formatMinor, track } from "@ubi/mobile-core";
import type { MpWeekday } from "@ubi/contracts";
import {
  marketplaceApi,
  type MpDriverPreferences,
  type MpDriverPreferencesPatch,
} from "../../api/marketplace";
import { requestLocationPermission } from "../../lib/location";
import {
  DriverPreferencesScreen,
  type PrefsBanner,
  type PrefsDraft,
  type PrefsOption,
} from "./DriverPreferencesScreen";
import { MP_DRIVER_TID } from "./testIds";

const QUERY_KEY = ["mp", "preferences"] as const;

// Input packaging only, exactly like RateProfileContainer: whole-major digits typed by the
// driver ↔ minor units. No fee, net or total is ever derived here.
const majorDigits = (minor: number) => String(Math.round(minor / 100));
const toMinor = (raw: string) =>
  (parseInt(raw.replace(/\D/g, ""), 10) || 0) * 100;

const WEEKDAYS: PrefsOption<MpWeekday>[] = [
  { label: "Mon", value: "mon" },
  { label: "Tue", value: "tue" },
  { label: "Wed", value: "wed" },
  { label: "Thu", value: "thu" },
  { label: "Fri", value: "fri" },
  { label: "Sat", value: "sat" },
  { label: "Sun", value: "sun" },
];
// Candidate chips; only those inside the SERVER's bounds are offered.
const PICKUP_CANDIDATES_M = [1_000, 2_000, 3_000, 5_000, 8_000];
const RADIUS_CANDIDATES_M = [2_000, 5_000, 10_000, 20_000];

const km = (meters: number) =>
  (meters % 1_000 === 0
    ? String(meters / 1_000)
    : (meters / 1_000).toFixed(1)) + " km";

/** "07:30" → 450; null when it is not a 24h HH:MM time. "24:00" ends a day. */
export const parseClock = (raw: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
};
const clock = (minute: number) =>
  String(Math.floor(minute / 60)).padStart(2, "0") +
  ":" +
  String(minute % 60).padStart(2, "0");

export const draftOf = (view: MpDriverPreferences): PrefsDraft => ({
  minTripMajor: view.minimumTripAmountMinor
    ? majorDigits(view.minimumTripAmountMinor.amountMinor)
    : "",
  maxPickupMeters: view.maxPickupDistanceMeters,
  acceptsDeliveries: view.acceptsDeliveries,
  acceptsStops: view.acceptsStops,
  maxStops: view.maxStops,
  homeward: view.homeward ? { ...view.homeward } : null,
  homewardOnly: view.homewardOnly,
  windows: view.availabilityWindows.map((w) => ({ ...w })),
});

const windowKey = (w: {
  day: string;
  startMinute: number;
  endMinute: number;
}) => w.day + ":" + w.startMinute + "-" + w.endMinute;

/**
 * The PATCH body for a draft: expectedVersion plus ONLY what changed. An empty
 * change set (just expectedVersion) means there is nothing to save.
 */
export const patchOf = (
  view: MpDriverPreferences,
  draft: PrefsDraft,
): MpDriverPreferencesPatch => {
  const patch: MpDriverPreferencesPatch = { expectedVersion: view.version };
  const savedMin = view.minimumTripAmountMinor?.amountMinor ?? null;
  const draftMin =
    draft.minTripMajor === "" ? null : toMinor(draft.minTripMajor);
  if (draftMin !== savedMin) {
    patch.minimumTripAmountMinor =
      draftMin === null
        ? null
        : { amountMinor: draftMin, currency: view.currency };
  }
  if (draft.maxPickupMeters !== view.maxPickupDistanceMeters)
    patch.maxPickupDistanceMeters = draft.maxPickupMeters;
  if (draft.acceptsDeliveries !== view.acceptsDeliveries)
    patch.acceptsDeliveries = draft.acceptsDeliveries;
  if (draft.acceptsStops !== view.acceptsStops)
    patch.acceptsStops = draft.acceptsStops;
  if (draft.acceptsStops && draft.maxStops !== view.maxStops)
    patch.maxStops = draft.maxStops;
  const saved = view.homeward;
  const next = draft.homeward;
  if (
    (saved === null) !== (next === null) ||
    (saved &&
      next &&
      (saved.lat !== next.lat ||
        saved.lng !== next.lng ||
        saved.radiusMeters !== next.radiusMeters ||
        saved.label !== next.label))
  ) {
    patch.homeward = next
      ? {
          lat: next.lat,
          lng: next.lng,
          radiusMeters: next.radiusMeters,
          label: next.label,
        }
      : null;
  }
  if (draft.homewardOnly !== view.homewardOnly)
    patch.homewardOnly = draft.homewardOnly;
  const savedWindows = view.availabilityWindows.map(windowKey).join(",");
  if (draft.windows.map(windowKey).join(",") !== savedWindows) {
    patch.availabilityWindows = draft.windows.map((w) => ({
      day: w.day,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
    }));
  }
  return patch;
};

const hasChanges = (patch: MpDriverPreferencesPatch) =>
  Object.keys(patch).length > 1;

const newIdempotencyKey = () =>
  "prefs_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2, 10);

/** A failure that never reached the server (no ApiError) is the offline case. */
const isOffline = (e: unknown) => !(e instanceof ApiError);

export function DriverPreferencesContainer() {
  const nav = useNavigation<{
    navigate: (n: string) => void;
    goBack: () => void;
  }>();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: QUERY_KEY,
    queryFn: marketplaceApi.preferences,
    retry: false,
  });
  const view = q.data;

  const [draft, setDraft] = useState<PrefsDraft | null>(null);
  const [banner, setBanner] = useState<PrefsBanner>(null);
  const [homewardBusy, setHomewardBusy] = useState(false);
  const [homewardError, setHomewardError] = useState<string | null>(null);
  const [newWindow, setNewWindow] = useState<{
    day: MpWeekday;
    start: string;
    end: string;
  }>({
    day: "mon",
    start: "",
    end: "",
  });
  const [windowError, setWindowError] = useState<string | null>(null);
  const seededFor = useRef<string | null>(null);
  // One Idempotency-Key per distinct change: reused on retry, replaced when the change does.
  const pendingKey = useRef<{ body: string; key: string } | null>(null);

  // Seed the draft from the server once per saved version (and after a conflict reload).
  useEffect(() => {
    if (!view) return;
    const seed = view.cityId + ":v" + view.version;
    if (seededFor.current === seed) return;
    seededFor.current = seed;
    setDraft(draftOf(view));
  }, [view]);

  const patch = useMemo(
    () => (view && draft ? patchOf(view, draft) : null),
    [view, draft],
  );

  const save = useMutation({
    mutationFn: (body: MpDriverPreferencesPatch) => {
      const encoded = JSON.stringify(body);
      if (!pendingKey.current || pendingKey.current.body !== encoded)
        pendingKey.current = { body: encoded, key: newIdempotencyKey() };
      return marketplaceApi.patchPreferences(body, pendingKey.current.key);
    },
    onSuccess: (saved) => {
      pendingKey.current = null;
      queryClient.setQueryData(QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: ["mp", "feed"] });
      setBanner({
        kind: "saved",
        title: "Preferences saved",
        body:
          "Your feed now uses version " +
          saved.version +
          ". Offers you already made are unchanged.",
      });
      track("driver_mp_preferences_saved", { version: saved.version });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "version_conflict") {
        pendingKey.current = null;
        seededFor.current = null; // reseed from the server's newer version
        setBanner({
          kind: "conflict",
          title: "Changed on another device",
          body: "We reloaded your saved preferences. Review them and save again.",
        });
        void q.refetch();
        return;
      }
      if (isOffline(e)) {
        setBanner({
          kind: "offline",
          title: "You’re offline",
          body: "Nothing was saved. Your changes stay here — save again when you’re back online.",
        });
        return;
      }
      setBanner({
        kind: "error",
        title: "Couldn’t save your preferences",
        body: (e as Error).message,
      });
    },
  });

  if (!view || !draft) {
    if (q.isError) {
      const offline = isOffline(q.error);
      const unavailable =
        q.error instanceof ApiError &&
        (q.error.code === "feature_disabled" ||
          q.error.code === "market_not_configured");
      const loadFailure = offline
        ? {
            tone: "warn" as const,
            title: "You’re offline",
            body: "Your preferences load from the server. Reconnect and try again.",
          }
        : {
            tone: unavailable ? ("neutral" as const) : ("error" as const),
            title: unavailable
              ? "Not available here yet"
              : "Couldn’t load your preferences",
            body: (q.error as Error).message,
          };
      return (
        <Screen title="Preferences" onBack={nav.goBack} bg="bg2">
          <Banner
            testID={
              offline ? MP_DRIVER_TID.prefs.offline : MP_DRIVER_TID.prefs.error
            }
            tone={loadFailure.tone}
            title={loadFailure.title}
            body={loadFailure.body}
          />
          <Button
            testID={MP_DRIVER_TID.prefs.retry}
            label="Try again"
            kind="secondary"
            onPress={() => void q.refetch()}
          />
        </Screen>
      );
    }
    return (
      <Screen title="Preferences" onBack={nav.goBack} bg="bg2">
        <Skeleton height={120} />
        <Skeleton height={160} />
        <Skeleton height={140} />
      </Screen>
    );
  }

  // A refetch that failed while a copy is on screen: keep it readable, say it may be old.
  const staleBanner: PrefsBanner =
    q.isError && isOffline(q.error)
      ? {
          kind: "offline",
          title: "You’re offline",
          body: "Showing your last loaded preferences. Changes can’t be saved until you reconnect.",
        }
      : null;

  const bounds = view.bounds;
  const pickupOptions: PrefsOption<number | null>[] = [
    { label: "Request area", value: null },
    ...Array.from(
      new Set(
        [
          ...PICKUP_CANDIDATES_M,
          ...(view.maxPickupDistanceMeters
            ? [view.maxPickupDistanceMeters]
            : []),
        ]
          .filter(
            (m) =>
              m >= bounds.maxPickupDistanceMeters.min &&
              m <= bounds.maxPickupDistanceMeters.max,
          )
          .sort((a, b) => a - b),
      ),
    ).map((m) => ({ label: km(m), value: m })),
  ];
  const maxStopsOptions: PrefsOption<number | null>[] = [
    { label: "Any", value: null },
    ...Array.from({ length: bounds.maxStopsCeiling + 1 }, (_, n) => ({
      label: n === 0 ? "No stops" : String(n),
      value: n,
    })),
  ];
  const radiusOptions: PrefsOption<number>[] = RADIUS_CANDIDATES_M.filter(
    (m) =>
      m >= bounds.homewardRadiusMeters.min &&
      m <= bounds.homewardRadiusMeters.max,
  ).map((m) => ({ label: "within " + km(m), value: m }));

  const onChange = (next: Partial<PrefsDraft>) => {
    setBanner(null);
    setDraft((current) => (current ? { ...current, ...next } : current));
  };

  const onSetHomeward = async () => {
    setHomewardError(null);
    setHomewardBusy(true);
    const granted = await requestLocationPermission();
    if (!granted) {
      setHomewardBusy(false);
      setHomewardError(
        "Allow location access to set your homeward area from where you are.",
      );
      return;
    }
    getCurrentPosition(
      (position) => {
        setHomewardBusy(false);
        const radius =
          draft.homeward?.radiusMeters ??
          radiusOptions[1]?.value ??
          radiusOptions[0]?.value ??
          bounds.homewardRadiusMeters.min;
        onChange({
          homeward: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            radiusMeters: radius,
            label: draft.homeward?.label ?? "Home",
          },
        });
      },
      () => {
        setHomewardBusy(false);
        setHomewardError(
          "We couldn’t get your position. Try again where the signal is better.",
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const onAddWindow = () => {
    const start = parseClock(newWindow.start);
    const end = parseClock(newWindow.end);
    if (start === null || end === null) {
      setWindowError("Use 24-hour times like 07:00 and 10:30.");
      return;
    }
    if (start >= end) {
      setWindowError(
        "A window must start before it ends. Split overnight windows in two.",
      );
      return;
    }
    setWindowError(null);
    const day =
      WEEKDAYS.find((d) => d.value === newWindow.day)?.label ?? newWindow.day;
    onChange({
      windows: [
        ...draft.windows,
        {
          day: newWindow.day,
          startMinute: start,
          endMinute: end,
          // Local label until saved; the server's own label replaces it on save.
          label: day + " " + clock(start) + "–" + clock(end) + " (unsaved)",
        },
      ],
    });
    setNewWindow({ ...newWindow, start: "", end: "" });
  };

  const minTripHint = bounds.minimumTripAmountMaxMinor
    ? "Up to " +
      formatMinor(bounds.minimumTripAmountMaxMinor) +
      ". Hides requests whose maximum fare can never reach it, and suggests it as an offer when a request asks less."
    : "Not available in this market.";
  const changed = patch !== null && hasChanges(patch);

  return (
    <DriverPreferencesScreen
      draft={draft}
      onChange={onChange}
      disclosure={view.disclosure}
      availabilityNote={view.availabilityNote}
      versionLine={
        view.version === 0
          ? "Not saved yet — nothing is filtered until you save."
          : "Saved as version " +
            view.version +
            ". Changes apply to your feed and suggestions only."
      }
      minTripHint={minTripHint}
      pickupOptions={pickupOptions}
      maxStopsOptions={maxStopsOptions}
      radiusOptions={radiusOptions}
      weekdays={WEEKDAYS}
      homewardLine={
        draft.homeward
          ? draft.homeward.label +
            " · within " +
            km(draft.homeward.radiusMeters)
          : null
      }
      settingHomeward={homewardBusy}
      homewardError={homewardError}
      onSetHomeward={() => void onSetHomeward()}
      onClearHomeward={() => onChange({ homeward: null, homewardOnly: false })}
      newWindow={newWindow}
      onNewWindow={setNewWindow}
      windowError={windowError}
      onAddWindow={onAddWindow}
      onRemoveWindow={(index) =>
        onChange({ windows: draft.windows.filter((_, i) => i !== index) })
      }
      onOpenRates={() => nav.navigate("Rates")}
      banner={banner ?? staleBanner}
      saving={save.isPending}
      canSave={changed && !save.isPending}
      onSave={() => patch && changed && save.mutate(patch)}
      onBack={nav.goBack}
    />
  );
}
