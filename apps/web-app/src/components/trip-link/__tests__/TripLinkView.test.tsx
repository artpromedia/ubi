/**
 * The passenger trip page's view, rendered with react-dom/server for every state it has:
 * missing link, expired / revoked / invalid refusals, the live trip (verified driver card,
 * ETA with its basis, pickup PIN, support and the free decline), an unresolved driver card,
 * and the declined state. The view prints only what the server served — nothing about the
 * requester or the money.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WEB_TEST_IDS } from "../../travel/types";
import { TripLinkView, type TripLinkViewProps } from "../TripLinkView";
import { tripView } from "../../../lib/__tests__/trip-link.fixtures";

const TID = WEB_TEST_IDS.tripLink;
const noop = () => {};
const has = (html: string, id: string) => html.includes(`data-testid="${id}"`);

const trip = (
  over: Partial<Extract<TripLinkViewProps, { phase: "trip" }>> = {},
) =>
  renderToStaticMarkup(
    <TripLinkView
      phase="trip"
      view={tripView()}
      stale={false}
      pin={{ state: "hidden" }}
      onRevealPin={noop}
      decline={{ confirming: false, busy: false, refusal: null }}
      onDecline={noop}
      onConfirmDecline={noop}
      onCancelDecline={noop}
      onRefresh={noop}
      {...over}
    />,
  );

describe("TripLinkView", () => {
  it("asks for the texted link when the page has no token", () => {
    const html = renderToStaticMarkup(<TripLinkView phase="missing" />);
    expect(has(html, TID.missing)).toBe(true);
    expect(html).toContain("Open the link from your text");
  });

  it("words an expired, a revoked and an invalid link differently — none offer a retry", () => {
    const expired = renderToStaticMarkup(
      <TripLinkView phase="refused" failure="expired" onRetry={noop} />,
    );
    expect(has(expired, TID.expired)).toBe(true);
    expect(expired).toContain("This trip link has expired");
    expect(has(expired, TID.retry)).toBe(false);

    const revoked = renderToStaticMarkup(
      <TripLinkView phase="refused" failure="revoked" />,
    );
    expect(has(revoked, TID.revoked)).toBe(true);
    expect(revoked).toContain("replaced or withdrawn");

    const invalid = renderToStaticMarkup(
      <TripLinkView phase="refused" failure="invalid" />,
    );
    expect(has(invalid, TID.invalid)).toBe(true);
    expect(invalid).toContain("This link doesn’t work");
  });

  it("offers a retry when offline", () => {
    const html = renderToStaticMarkup(
      <TripLinkView phase="refused" failure="offline" onRetry={noop} />,
    );
    expect(has(html, TID.error)).toBe(true);
    expect(has(html, TID.retry)).toBe(true);
    expect(html).toContain("You’re offline");
  });

  it("shows the live trip: status, ETA with its basis, verified driver card, PIN button, support and the free decline", () => {
    const html = trip();
    expect(html).toContain("Hi Ngozi");
    expect(html).toContain("Your driver is on the way");
    expect(has(html, TID.eta)).toBe(true);
    expect(html).toContain("About 6 min away");
    expect(html).toContain("estimate as of");
    expect(has(html, TID.driver)).toBe(true);
    expect(html).toContain("Chidi Obi");
    expect(html).toContain("LAG ·· 42A");
    expect(html).toContain("Verified by UBI");
    expect(has(html, TID.pinReveal)).toBe(true);
    expect(has(html, TID.support)).toBe(true);
    expect(html).toContain("TRP-7Q2K");
    expect(html).toContain('href="tel:112"');
    expect(has(html, TID.decline)).toBe(true);
    expect(html).toContain("Decline this ride (free)");
    // Nothing about money or the person who booked.
    expect(html).not.toMatch(/₦|NGN|fare|requester/i);
  });

  it("shows the PIN once fetched, and the decline confirmation with the server's note", () => {
    const shown = trip({ pin: { state: "shown", pin: "4831" } });
    expect(has(shown, TID.pin)).toBe(true);
    expect(shown).toContain("4831");
    expect(shown).toContain('aria-label="Pickup PIN 4 8 3 1"');

    const confirming = trip({
      decline: { confirming: true, busy: false, refusal: null },
    });
    expect(has(confirming, TID.declineConfirm)).toBe(true);
    expect(confirming).toContain(
      "Declining before pickup is free. The person who booked the ride is told.",
    );
    const refused = trip({
      decline: {
        confirming: true,
        busy: false,
        refusal: {
          title: "Your ride has already started",
          body: "It can no longer be declined here.",
        },
      },
    });
    expect(has(refused, TID.refusal)).toBe(true);
    expect(refused).toContain("Your ride has already started");
  });

  it("never shows a name or plate for an unresolved driver card", () => {
    const html = trip({
      view: tripView({
        driver: {
          displayName: "Driver 4F2A",
          initials: "D",
          rating: "–",
          completedTrips: 0,
          vehicle: "standard",
          plateMasked: "—",
          profileStatus: "unavailable",
        },
      }),
    });
    expect(html).toContain("Driver details unavailable");
    expect(html).not.toContain("Driver 4F2A");
    expect(html).not.toContain("–");
  });

  it("before a driver is confirmed says so; after a decline, says it was free and offers nothing more", () => {
    const finding = trip({
      view: tripView({
        status: "finding_driver",
        statusLabel: "Finding your driver",
        driver: null,
        eta: null,
        pickupVerification: {
          method: "pin",
          pinAvailable: false,
          instructions: "Tell your driver your 4-digit PIN before you get in.",
        },
      }),
    });
    expect(has(finding, TID.noDriver)).toBe(true);
    expect(has(finding, TID.pinUnavailable)).toBe(true);
    expect(has(finding, TID.pinReveal)).toBe(false);

    const declined = trip({
      view: tripView({
        status: "declined",
        statusLabel: "You declined this ride",
        actions: {
          canDecline: false,
          declineIsFree: true,
          declineNote: "Declining before pickup is free.",
        },
      }),
    });
    expect(has(declined, TID.declined)).toBe(true);
    expect(declined).toContain("Nothing was charged to you.");
    expect(has(declined, TID.decline)).toBe(false);
    expect(has(declined, TID.pinReveal)).toBe(false);
  });

  it("marks a failed refresh as stale with the time of the last update", () => {
    const html = trip({ stale: true });
    expect(html).toContain("Couldn’t refresh — showing the update from");
    expect(has(html, TID.retry)).toBe(true);
  });
});
