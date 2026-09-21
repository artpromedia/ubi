// Foreground location watch for the driver app (C05 / G05).
//
// Uses react-native-geolocation-service — the same free, foreground-only
// module rider-mobile already depends on — instead of the commercial,
// license-keyed react-native-background-geolocation that was declared in
// this app's package.json but never imported (G05's own finding). Background
// tracking (while the app is backgrounded or killed) is explicitly OUT OF
// SCOPE for this slice: it needs native Info.plist/AndroidManifest
// background-location entitlements this repo has not configured, plus an
// Apple/Google store-review-justified disclosure of a background-location use
// case — both are product/legal decisions, not something a code change here
// can resolve.
//
// What this module does:
//  1. Requests foreground location permission (iOS "when in use", Android
//     fine location) — denial degrades to the honest `stale_location` motion
//     state (see motion.ts), never to a silently-granted parked state.
//  2. Watches position while the caller says the driver is online or on a
//     trip (useLocationWatch(active)).
//  3. Sends ACCEPTED points to POST /v1/drivers/me/locations in the exact
//     shape ride-service's IngestLocations handler expects
//     (services/ride-service/internal/domain/driver.go LocationPoint):
//     { seq, lat, lng, accuracyMeters, heading?, speedMetersPerSecond?, recordedAt }.
//     This endpoint IS reachable through the gateway — api-gateway proxies
//     /v1/drivers/* to ride-service (services/api-gateway/src/routes/proxy.ts)
//     — so G05's "no location plumbing" finding is about this client never
//     having sent anything, not about a missing server route. `Arrived`
//     (POST /v1/rides/{id}/arrived) requires a fresh, in-geofence position
//     recorded this way, so this module is a functional prerequisite for the
//     Trip.Navigate → Waiting step, not just a telemetry nice-to-have.
//  4. Feeds speed/staleness into the shared motion gate: fast movement or a
//     stale fix immediately PAUSES bidding (motion.reportMovementDetected /
//     reportLocationStale). It never grants parked_confirmed — only the
//     driver's explicit, server-acknowledged attestation
//     (useMotionGate().confirmParked()) may do that (see motion.ts).
import { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import {
  requestAuthorization,
  watchPosition,
  clearWatch,
  type GeoPosition,
  type GeoError,
} from "react-native-geolocation-service";
import { api } from "@ubi/mobile-core";
import { reportMovementDetected, reportLocationStale } from "./motion";

/** A point in the shape POST /v1/drivers/me/locations expects. */
type LocationPoint = {
  seq: number;
  lat: number;
  lng: number;
  accuracyMeters: number;
  heading?: number;
  speedMetersPerSecond?: number;
  recordedAt: string;
};

// Physics thresholds, not commercial policy — mirrors the server's own
// stance (services/ride-service/internal/move/drivers.go) that these are
// sensor-quality judgments, so they live in code.
const MOVING_SPEED_MPS = 2.5; // ~9 km/h: a driver rolling, not just adjusting on foot
const STALE_AFTER_MS = 20_000;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 20;
const WATCH_OPTIONS = {
  enableHighAccuracy: true,
  distanceFilter: 10,
  interval: 4_000,
  fastestInterval: 2_000,
  forceRequestLocation: true,
  showLocationDialog: true,
};

let watchId: number | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;
// A timestamp-seeded, monotonically increasing counter. The server rejects
// out-of-order seqs per driver session (LocationRejectedStaleSeq); seeding
// from Date.now() rather than 0 means a fresh app process still sends seqs
// higher than any previous session's, without needing to persist or fetch
// the server's last-seen value first.
let seqCounter = Date.now();
let queue: LocationPoint[] = [];
let lastAcceptedAt: number | null = null;

/** iOS "when in use" / Android fine-location. No background permission is requested. */
export async function requestLocationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === "ios") {
      const status = await requestAuthorization("whenInUse");
      return status === "granted";
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: "Location access",
        message:
          "UBI Driver needs your location to confirm pickups and match you with nearby trips.",
        buttonPositive: "Allow",
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await api("POST", "/v1/drivers/me/locations", { points: batch });
  } catch {
    // Drop rather than grow unbounded. A dropped batch is not silent to the
    // matching engine: the server judges staleness from the wall-clock gap
    // to the NEXT accepted point, and this app's own stale-check (below)
    // independently pauses bidding when nothing has been accepted recently.
  }
}

function onPosition(pos: GeoPosition): void {
  lastAcceptedAt = Date.now();
  const speedMps = pos.coords.speed; // null: platform reports "unknown"
  if (speedMps !== null && speedMps >= 0 && speedMps > MOVING_SPEED_MPS) {
    reportMovementDetected();
  }
  seqCounter += 1;
  queue.push({
    seq: seqCounter,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyMeters: pos.coords.accuracy,
    heading:
      pos.coords.heading !== null && pos.coords.heading >= 0
        ? pos.coords.heading
        : undefined,
    speedMetersPerSecond:
      speedMps !== null && speedMps >= 0 ? speedMps : undefined,
    recordedAt: new Date(pos.timestamp).toISOString(),
  });
  if (queue.length >= MAX_BATCH) void flush();
}

function onError(_err: GeoError): void {
  // A watch error (radio off, denied mid-session, provider unavailable) is
  // exactly a stale signal — the honest default applies, not a guess.
  reportLocationStale();
}

function checkStale(): void {
  if (lastAcceptedAt === null || Date.now() - lastAcceptedAt > STALE_AFTER_MS) {
    reportLocationStale();
  }
}

/** Starts the foreground watch. A no-op if already watching. */
export function startLocationWatch(): void {
  if (watchId !== null) return;
  lastAcceptedAt = null;
  watchId = watchPosition(onPosition, onError, WATCH_OPTIONS);
  staleTimer = setInterval(checkStale, 5_000);
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
}

/** Stops the watch and drops anything unsent — a resumed watch starts clean. */
export function stopLocationWatch(): void {
  if (watchId !== null) {
    clearWatch(watchId);
    watchId = null;
  }
  if (staleTimer !== null) {
    clearInterval(staleTimer);
    staleTimer = null;
  }
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  queue = [];
  lastAcceptedAt = null;
}

/** Test-only reset, mirroring motion.ts's resetMotionForDev. */
export function resetLocationForTest(): void {
  stopLocationWatch();
  seqCounter = Date.now();
}

export type LocationWatchState =
  | "stopped"
  | "starting"
  | "watching"
  | "permission_denied";

/**
 * Mount at the app's online/on-trip boundary (HomeScreen while online; the
 * Trip stack while on a trip) — never globally, since this app has no reason
 * to watch position while signed out or offline.
 */
export function useLocationWatch(active: boolean): LocationWatchState {
  const [state, setState] = useState<LocationWatchState>("stopped");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!active) {
      stopLocationWatch();
      setState("stopped");
      return () => {
        mounted.current = false;
      };
    }
    setState("starting");
    void requestLocationPermission().then((granted) => {
      if (!mounted.current) return;
      if (!granted) {
        // Denial keeps the motion gate at its honest default — it must never
        // read as "parked" just because telemetry can't run.
        reportLocationStale();
        setState("permission_denied");
        return;
      }
      startLocationWatch();
      setState("watching");
    });
    return () => {
      mounted.current = false;
      stopLocationWatch();
    };
  }, [active]);
  return state;
}
