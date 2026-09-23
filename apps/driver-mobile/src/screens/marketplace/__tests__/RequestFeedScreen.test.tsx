import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "@ubi/mobile-ui";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { RequestFeedScreen, type RequestFeedProps } from "../RequestFeedScreen";

// D07 motion gate: while moving, bid affordances are NOT RENDERED (never
// disabled-and-tempting), at most one deferred banner, no countdowns.
const NGN = (major: number) => ({ amountMinor: major * 100, currency: "NGN" });
const baseProps: RequestFeedProps = {
  motion: "parked_confirmed",
  online: true,
  areaLabel: "Lekki",
  earningsTodayLabel: "",
  tab: "feed",
  onTab: () => {},
  requests: [
    {
      requestId: "req_1",
      revision: 1,
      title: "Lekki Phase 1 → Victoria Island",
      meta: "Ride · Economy · 8.4 km",
      askedMinor: NGN(2800),
      askedByLabel: "rider asks",
      capabilityBadge: null,
      expiresLabel: "2:05",
      earnings: null,
      homeward: false,
    },
  ],
  onOpen: () => {},
  deferredPrompt: null,
  reconnected: false,
  myBids: [],
  parkedConfirm: null,
  quickLinks: [],
  preferences: null,
};
const renderFeed = (over: Partial<RequestFeedProps>) =>
  render(
    <ThemeProvider defaultMode="dark">
      <RequestFeedScreen {...baseProps} {...over} />
    </ThemeProvider>,
  );

describe("RequestFeedScreen — D07 motion gate", () => {
  it("renders request cards when parked", () => {
    renderFeed({});
    expect(
      screen.getByTestId(dynamicTestId(TEST_IDS.mp.driver.feed.card, "req_1")),
    ).toBeTruthy();
    expect(screen.getByTestId(TEST_IDS.mp.driver.feed.list)).toBeTruthy();
  });

  it("while moving, renders NO bid affordances at all — not disabled ones", () => {
    renderFeed({
      motion: "moving",
      deferredPrompt: "1 request near your drop-off",
      parkedConfirm: { confirming: false, error: null, onConfirm: () => {} },
    });
    // No feed list, no request cards, no My offers tab.
    expect(screen.queryByTestId(TEST_IDS.mp.driver.feed.list)).toBeNull();
    expect(
      screen.queryByTestId(
        dynamicTestId(TEST_IDS.mp.driver.feed.card, "req_1"),
      ),
    ).toBeNull();
    expect(screen.queryByTestId(TEST_IDS.mp.driver.feed.myBids)).toBeNull();
    // Exactly one deferred banner, with no actions attached to it.
    expect(
      screen.getByTestId(TEST_IDS.mp.driver.feed.movingBanner),
    ).toBeTruthy();
    expect(screen.getByText("1 request near your drop-off")).toBeTruthy();
    // The only control is the explicit parked attestation; no countdowns anywhere.
    expect(screen.getByText("I am safely parked")).toBeTruthy();
    expect(screen.queryByText(/expires/)).toBeNull();
  });

  it("while moving without a nearby request, shows no banner at all (one deferred prompt max)", () => {
    renderFeed({
      motion: "moving",
      deferredPrompt: null,
      parkedConfirm: { confirming: false, error: null, onConfirm: () => {} },
    });
    expect(
      screen.queryByTestId(TEST_IDS.mp.driver.feed.movingBanner),
    ).toBeNull();
  });

  it("stale location keeps the feed visible but says bidding is paused", () => {
    renderFeed({
      motion: "stale_location",
      parkedConfirm: { confirming: false, error: null, onConfirm: () => {} },
    });
    expect(screen.getByText(/bidding paused until GPS recovers/)).toBeTruthy();
    expect(screen.getByTestId(TEST_IDS.mp.driver.feed.list)).toBeTruthy();
  });

  it("lost bid with an unconfirmed release shows release pending, never released", () => {
    renderFeed({
      tab: "myBids",
      myBids: [
        {
          bidId: "bid_b",
          title: "Ikeja → Maryland",
          amountMinor: NGN(2200),
          status: "lost",
          holdMinor: NGN(220),
          holdState: "release_pending",
          holdDetail: "your money returns once the choice is final",
        },
      ],
    });
    expect(screen.getByText(/release pending/)).toBeTruthy();
    expect(screen.queryByText(/^released/)).toBeNull();
  });
});
