import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@ubi/mobile-ui';
import { TEST_IDS, dynamicTestId } from '@ubi/contracts';
import { FareEditorScreen, type FareEditorProps } from '../src/screens/marketplace/FareEditorScreen';
import { OfferInboxScreen, type Offer, type OfferInboxProps } from '../src/screens/marketplace/OfferInboxScreen';
import { mergeArrivalOrder, sortOfferIds, displayOrder } from '../src/screens/marketplace/offerOrder';
import type { MpOfferDto } from '../src/api/marketplace';

const NGN = (major: number) => ({ amountMinor: major * 100, currency: 'NGN' });
const noop = () => {};

// Board R02: the fare editor blocks publish below the floor with the SERVER's inline error,
// and the bounds stay visible next to the field (acceptance checklist, MANIFEST.md).
describe('FareEditorScreen below-floor error state', () => {
  const props: FareEditorProps = {
    quote: {
      quoteId: 'q_mp_1',
      suggestedFareMinor: NGN(2600), minimumFareMinor: NGN(2400), maximumFareMinor: NGN(3900),
      currency: 'NGN', expiresAt: new Date(Date.now() + 120_000).toISOString(), pricingVersion: 'px_2026_09_1',
      breakdown: [{ label: 'Base', amountMinor: NGN(700) }],
    },
    quoteState: 'live',
    amountRaw: '2000', amountMinor: NGN(2000), onAmountChange: noop,
    fieldError: 'Below the minimum for this route. Enter at least ₦2,400.',
    belowSuggestionHint: null,
    presets: [{ label: 'Suggested · ₦2,600', amountMinor: NGN(2600) }],
    onPresetSelect: noop, onRefreshQuote: noop, onReview: noop, onBack: noop,
    review: { visible: false, payment: 'UBI Wallet', cancellation: 'Free to cancel', publishing: false, publishError: null, onSend: noop, onEdit: noop, onDismiss: noop },
  };
  it('renders the server field error, keeps bounds visible and disables Review', () => {
    render(<ThemeProvider defaultMode="light"><FareEditorScreen {...props} /></ThemeProvider>);
    expect(screen.getByText('Below the minimum for this route. Enter at least ₦2,400.')).toBeTruthy();
    expect(screen.getByTestId(TEST_IDS.mp.rider.fare.minMaxHint)).toBeTruthy();
    expect(screen.getByText('₦2,400')).toBeTruthy(); // minimum
    expect(screen.getByText('₦3,900')).toBeTruthy(); // maximum
    const review = screen.getByTestId(TEST_IDS.mp.rider.fare.review);
    expect(review.props.accessibilityState?.disabled).toBe(true);
  });
});

// Board R04: list order is stable across updates, and withdrawn offers strike through and
// STAY instead of vanishing mid-interaction.
describe('OfferInboxScreen stable order + withdrawn rendering', () => {
  const offer = (bidId: string, name: string, major: number, withdrawn = false): Offer => ({
    bidId, bidVersion: 1, driverName: name, rating: '4.8', trips: 1200, vehicle: 'Toyota Corolla', initials: name.slice(0, 2).toUpperCase(),
    amountMinor: NGN(major), deltaLabel: null, kind: 'immediate', pickupLabel: 'Pickup in 4 min', expiresLabel: '2 min', withdrawn,
  });
  const props = (offers: Offer[]): OfferInboxProps => ({
    phase: 'offers', connection: 'online', requestedMinor: NGN(2800), elapsedLabel: '1:12', expiresLabel: 'in 2 min',
    envelopeLabel: 'Eligible drivers within 3 km can see your request', widenedBanner: null,
    sort: 'price', onSort: noop, offers, onOpenOffer: noop, unavailableNotice: null, onCancel: noop, onRepost: noop,
  });
  it('keeps arrival order on update and keeps a struck-through withdrawn card in place', () => {
    const first = [offer('bid_emeka', 'Emeka', 2800), offer('bid_tunde', 'Tunde', 3000)];
    render(<ThemeProvider defaultMode="light"><OfferInboxScreen {...props(first)} /></ThemeProvider>);
    const orderBefore = screen.getAllByTestId(/^mp\.rider\.offers\.card\./).map(n => n.props.testID);
    expect(orderBefore).toEqual(['mp.rider.offers.card.bid_emeka', 'mp.rider.offers.card.bid_tunde']);

    // Update arrives: Tunde withdraws, Chidi appends. Nothing reshuffles, nothing vanishes.
    const next = [offer('bid_emeka', 'Emeka', 2800), offer('bid_tunde', 'Tunde', 3000, true), offer('bid_chidi', 'Chidi', 2800)];
    screen.rerender(<ThemeProvider defaultMode="light"><OfferInboxScreen {...props(next)} /></ThemeProvider>);
    const orderAfter = screen.getAllByTestId(/^mp\.rider\.offers\.card\./).map(n => n.props.testID);
    expect(orderAfter).toEqual(['mp.rider.offers.card.bid_emeka', 'mp.rider.offers.card.bid_tunde', 'mp.rider.offers.card.bid_chidi']);

    // Withdrawn card is still rendered (struck through + printed word), and no longer tappable.
    const withdrawnCard = screen.getByTestId(dynamicTestId(TEST_IDS.mp.rider.offers.card, 'bid_tunde'));
    expect(withdrawnCard.props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText('Cancelled · withdrawn')).toBeTruthy();
    const flatStyle = [screen.getByText('Tunde · ★ 4.8').props.style].flat(Infinity);
    expect(flatStyle).toContainEqual(expect.objectContaining({ textDecorationLine: 'line-through' }));
  });
});

// Pure ordering helpers used by the container: arrival order is append-only; an explicit sort
// snapshots the order; later arrivals append AFTER the snapshot instead of reshuffling it.
describe('offerOrder helpers', () => {
  const dto = (bidId: string, major: number, kind: 'immediate' | 'finishing_trip' = 'immediate', earliestSec = 0): MpOfferDto => ({
    bidId, bidVersion: 1, requestRevision: 1, amountMinor: NGN(major), kind,
    driver: { displayName: 'D', initials: 'D', rating: '4.8', completedTrips: 10, vehicle: 'V', plateMasked: 'P' },
    pickupLabel: 'Pickup', pickupWindow: kind === 'finishing_trip' ? { earliestSec, latestSec: earliestSec + 300, etaVersion: 1 } : null,
    expiresAt: new Date().toISOString(), withdrawn: false, whyRecommended: null,
  });
  it('mergeArrivalOrder appends new ids and never reorders or drops', () => {
    const a = mergeArrivalOrder([], [dto('a', 3000), dto('b', 2800)]);
    expect(a).toEqual(['a', 'b']);
    expect(mergeArrivalOrder(a, [dto('b', 2800), dto('c', 2900)])).toEqual(['a', 'b', 'c']);
    expect(mergeArrivalOrder(a, [dto('b', 2800)])).toEqual(['a', 'b']); // dropped upstream, kept here
  });
  it('sortOfferIds orders by server amount for price, immediate-first for eta', () => {
    const offers = [dto('a', 3000), dto('b', 2800, 'finishing_trip', 720), dto('c', 2800)];
    expect(sortOfferIds(offers, 'price')).toEqual(['b', 'c', 'a']);
    expect(sortOfferIds(offers, 'eta')).toEqual(['a', 'c', 'b']);
  });
  it('displayOrder appends post-sort arrivals after the explicit snapshot', () => {
    expect(displayOrder(['a', 'b', 'c', 'd'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b', 'd']);
    expect(displayOrder(['a', 'b'], null)).toEqual(['a', 'b']);
  });
});
