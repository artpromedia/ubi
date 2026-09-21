// Location → motion gate (C05 / G05). Real location.ts + motion.ts, mocked at
// the two edges: react-native-geolocation-service (native) and the HTTP layer
// (installFixtures). Proves telemetry can only ever PAUSE bidding — a fast
// fix flips to "moving" and a stale watch flips to "stale_location" — and
// never grants "parked_confirmed" on its own (only the explicit server
// attestation in motion.ts may do that).
import { watchPosition, clearWatch } from "react-native-geolocation-service";
import { installFixtures } from "@ubi/mobile-core";
import {
  startLocationWatch,
  stopLocationWatch,
  resetLocationForTest,
} from "../location";
import { currentMotion, resetMotionForDev, setMotionForDev } from "../motion";

type PosCallback = (pos: {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
}) => void;
type ErrCallback = (err: { code: number; message: string }) => void;

const watchPositionMock = watchPosition as jest.Mock;
const clearWatchMock = clearWatch as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  resetMotionForDev();
  resetLocationForTest();
  watchPositionMock.mockClear();
  clearWatchMock.mockClear();
  installFixtures(async ({ method, path }) => {
    if (method === "POST" && path === "/v1/drivers/me/locations") {
      return {
        status: 200,
        json: { accepted: 1, rejected: 0, lastSeq: 1, points: [] },
      };
    }
    return undefined;
  });
});

afterEach(() => {
  stopLocationWatch();
  jest.useRealTimers();
});

describe("location.ts → motion gate", () => {
  it("a fast fix immediately pauses bidding, overriding even a server-attested parked state", () => {
    setMotionForDev("parked_confirmed"); // the driver was attested parked a moment ago
    startLocationWatch();
    const onPosition = watchPositionMock.mock.calls[0][0] as PosCallback;

    onPosition({
      coords: {
        latitude: 6.5,
        longitude: 3.4,
        accuracy: 8,
        heading: 90,
        speed: 12, // well above the ~9 km/h moving threshold
      },
      timestamp: Date.now(),
    });

    expect(currentMotion()).toBe("moving");
  });

  it("a stale watch (no fix for the timeout window) pauses bidding", () => {
    startLocationWatch();
    // No position ever arrives; advance past the stale check window.
    jest.advanceTimersByTime(21_000);
    expect(currentMotion()).toBe("stale_location");
  });

  it("a slow, fresh fix does NOT grant parked_confirmed on its own", () => {
    startLocationWatch();
    const onPosition = watchPositionMock.mock.calls[0][0] as PosCallback;

    onPosition({
      coords: {
        latitude: 6.5,
        longitude: 3.4,
        accuracy: 8,
        heading: 0,
        speed: 0,
      },
      timestamp: Date.now(),
    });

    // Telemetry alone never promotes the state — only the explicit server
    // attestation (motion.ts confirmParked()) may set parked_confirmed.
    expect(currentMotion()).toBe("stale_location");
  });

  it("sends accepted points in the server's exact field shape", async () => {
    let posted: { points: unknown[] } | undefined;
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/drivers/me/locations") {
        posted = body as { points: unknown[] };
        return {
          status: 200,
          json: { accepted: 1, rejected: 0, lastSeq: 1, points: [] },
        };
      }
      return undefined;
    });
    startLocationWatch();
    const onPosition = watchPositionMock.mock.calls[0][0] as PosCallback;
    onPosition({
      coords: {
        latitude: 6.5,
        longitude: 3.4,
        accuracy: 12,
        heading: 45,
        speed: 1,
      },
      timestamp: 1_700_000_000_000,
    });

    await jest.advanceTimersByTimeAsync(5_100);

    expect(posted?.points).toHaveLength(1);
    const point = posted!.points[0] as Record<string, unknown>;
    expect(point).toMatchObject({
      lat: 6.5,
      lng: 3.4,
      accuracyMeters: 12,
      heading: 45,
      speedMetersPerSecond: 1,
      recordedAt: new Date(1_700_000_000_000).toISOString(),
    });
    expect(typeof point.seq).toBe("number");
  });

  it("a watch error degrades to stale rather than a silent guess", () => {
    startLocationWatch();
    const onError = watchPositionMock.mock.calls[0][1] as ErrCallback;
    setMotionForDev("parked_confirmed");
    onError({ code: 2, message: "position unavailable" });
    expect(currentMotion()).toBe("stale_location");
  });

  it("stopLocationWatch clears the native watch", () => {
    startLocationWatch();
    stopLocationWatch();
    expect(clearWatchMock).toHaveBeenCalled();
  });
});
