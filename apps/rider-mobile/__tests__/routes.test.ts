import { linking } from "../src/navigation/linking";
import { routeAssertions } from "../src/__typetests__/routes.assert";

// The param-list typing itself is proven at compile time by
// src/__typetests__/routes.assert.ts (checked by `tsc --noEmit`). Here we assert
// the runtime deep-link surface that mirrors the Flutter go_router paths, plus
// that the compile-time assertions were part of this build.

describe("typed deep-link routes", () => {
  it("carries the ubi.africa prefixes", () => {
    expect(linking.prefixes).toContain("ubi://");
    expect(linking.prefixes).toContain("https://ubi.africa");
  });

  it("maps the Ask paths", () => {
    const screens = linking.config!.screens as Record<string, any>;
    expect(screens.Ask.screens.Thread).toBe("ask");
    expect(screens.Ask.screens.Execution).toBe("ask/executions/:executionId");
  });

  it("maps the Travel paths that existing links depend on", () => {
    const screens = linking.config!.screens as Record<string, any>;
    expect(screens.Travel.screens.FlightResults).toBe(
      "travel/flights/:searchId",
    );
    expect(screens.Travel.screens.OrderStatus).toBe("travel/orders/:orderId");
    expect(screens.Travel.screens.Disruption).toBe(
      "travel/orders/:orderId/disruption",
    );
    expect(screens.Travel.screens.RefundStatus).toBe(
      "travel/refunds/:refundId",
    );
  });

  it("maps the A02 trip and A03 Book for Later paths", () => {
    const screens = linking.config!.screens as Record<string, any>;
    const mp = screens.Marketplace.screens;
    expect(mp.Route).toBe("home/marketplace/:requestId/route");
    expect(mp.Trip).toBe("home/marketplace/:requestId/trip");
    expect(mp.ProposeChange).toBe("home/marketplace/:requestId/trip/change");
    expect(mp.Later).toBe("home/marketplace/later");
    expect(mp.Scheduled).toBe(
      "home/marketplace/later/scheduled/:scheduledRequestId",
    );
    expect(mp.AdvanceOffers).toBe("home/marketplace/:requestId/advance");
    expect(mp.Booking).toBe("home/marketplace/later/bookings/:bookingId");
    expect(mp.Series).toBe("home/marketplace/later/series/:templateId");
    // Object params (quoteParams) are in-app only — never a deep link.
    expect(mp.Schedule).toBeUndefined();
    expect(mp.Fare).toBeUndefined();
  });

  it("includes the compile-time route/param assertions in the build", () => {
    expect(routeAssertions).toBe(true);
  });
});
