# Rider-facing driver identity (G09) — what is real vs honestly unavailable

Status: **partial by design.** The rider-facing driver display is now honest
about what ride-service can and cannot verify. It does **not** fabricate a
rating or trip count as if they were real.

## The gap this closes

The audit's G09 pointed at a pseudonymous display: `maskedDriverView`
(`internal/marketplace/views.go`) returned `"Driver <hash>"`, `rating: "–"`,
`completedTrips: 0`, `plateMasked: "•••"`, and `vehicle = the requested class`.
The `0` trips read like a real "brand-new driver" figure, which it was not.

## What is verifiably available inside ride-service

Nothing identity- or reputation-shaped. Verified driver identity — legal/first
name, photo, vehicle registration/plate, star rating and completed-trip history
— is owned by **user-service**. ride-service holds **no projection** of it and
makes **no cross-service call** for it. The move core states this in its own
view layer: `internal/move/views.go` — _"names, plates and photos belong to
user-service, and privacy by role means this service"_ does not restate them.

The one server-**verified** fact is the **vehicle class**: the driver is
eligible for it and is bidding on it (eligibility gates on
`session.Offers(request.VehicleClass)`), so `vehicle` is real.

## The decision

`verifiedDriverView` (replacing `maskedDriverView`) returns the same fields plus
an explicit `profileStatus`:

- `profileStatus: "unavailable"` — the authoritative honesty gate. When set, the
  identity/rating fields are pseudonymous placeholders (`displayName:
"Driver <tag>"`, `rating: "–"`, `completedTrips: 0`, `plateMasked: "•••"`) that
  a client **must not** present as verified figures.
- `vehicle` — always the server-verified eligible class.

The offer projection (during bidding, `offerViewOf`), the winner projection
(after selection — the queue view's `driver`) and the queue projection all
derive the driver from this **one** function, so a driver never renders two
different ways. Tests assert the offer and queue drivers are identical and that
no numeric rating is invented (`TestWinnerAndOfferDriverConsistent`).

Wire types were deliberately **not** widened to nullable: the rider-mobile
screens (owned by another surface) read `rating: string` / `completedTrips:
number`, and a nullable would break their compile. `profileStatus` is an
additive field the screens ignore.

## Remaining dependency (new, tracked)

To show a **real** name, plate, rating and trip count, ride-service needs a
verified driver profile join. Two ways to supply it, both out of this slice's
scope (they cross a service boundary):

1. a synchronous read model / call to **user-service** for a privacy-scoped
   driver display card, or
2. a driver-profile **projection table** in ride-service kept in sync via
   user-service events.

When either lands: fill the verified branch of `verifiedDriverView`, flip
`profileStatus` to `"verified"`, and widen `rating`/`completedTrips` to nullable
across `@ubi/contracts`, the OpenAPI and the RN screens **in one change** so the
"unavailable" case can drop its placeholders. Tracked as a C06 addendum (A08).
