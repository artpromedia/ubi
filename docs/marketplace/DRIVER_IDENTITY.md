# Rider-facing driver identity (G09 / A06 part A / CC-A01)

Status: **implemented.** Rider-facing driver and vehicle cards resolve verified
identity, rating, trip history, and vehicle metadata through `user-service` and
`fleet-service`, and fall back honestly (`profileStatus: "unavailable"`) when a
profile cannot be verified rather than fabricating numbers.

## What was originally missing (G09)

In the initial marketplace prototype, `maskedDriverView`
(`internal/marketplace/views.go`) returned `"Driver <hash>"`, `rating: "–"`,
`completedTrips: 0`, `plateMasked: "•••"`, and `vehicle = the requested class`.
The `0` trips read like a real "brand-new driver" figure when no profile had
been fetched.

## Current architecture

1. **Verified driver profile port (`internal/marketplace/driverprofiles.go`, A06 part A):**
   - `ride-service` queries `user-service`'s privacy-limited internal read model:
     `GET {USER_SERVICE_URL}/internal/driver-profiles?ids=<uuid>,…` authenticated
     with `x-service-name: ride-service` and `x-service-key: DRIVER_PROFILE_RIDE_SERVICE_KEY`.
   - Responses are validated against `DriverProfilesResponseSchema`
     (`packages/contracts/src/driver-profile.ts`): display name, initials,
     verified photo reference, verification status (`verified` | `pending_review`
     | `not_current`), registered vehicle (`make`, `model`, `colour`, `type`,
     `plateMasked`), rating (`average`, `count`), `completedTrips`, and
     `memberSince`.
   - When `p.Verified()` is true (`Available && Verification.Status == "verified"`),
     `verifiedDriverView` emits `profileStatus: "verified"` along with the
     verified `displayName`, `rating`, `completedTrips`, `plateMasked`, and the
     rich `driverProfile` card (`MpOfferDriverProfileSchema`).

2. **Fleet vehicle overlay (`internal/marketplace/fleet_live.go`, CC-A01 / DEC-3 = A):**
   - When a fleet-managed driver goes online (`POST /v1/drivers/me/online`) or wins
     a live/advance marketplace award, `ride-service` resolves their active
     vehicle assignment from `fleet-service` (`GET /internal/fleet/drivers/{driverId}/vehicle-for-window`),
     persists the snapshot (`mp.driver_online_vehicles`, `mp.awards.fleet_vehicle`),
     and overlays the assigned fleet vehicle's masked plate (`•••XX`), make,
     model, and colour onto offer, award, queue, and receipt views.

3. **Honest fallback (`profileStatus: "unavailable"`):**
   - When `user-service` is unconfigured, unreachable, or the driver is not
     verified, `verifiedDriverView` sets `profileStatus: "unavailable"` and
     `driverProfile.status: "unavailable"`. Clients render `"Driver details
unavailable"` instead of presenting placeholder numbers as verified facts.
   - An offer or award is never blocked by a profile lookup failure.
