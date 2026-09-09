import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@ubi/mobile-ui';
import { RebateCard } from '../IncentivesScreen';
import type { Rebate } from '../../../api/incentives';

const NGN = (amountMinor: number) => ({ amountMinor, currency: 'NGN' });

// effectiveBps is deliberately set to a value that is NOT base − reduction
// (2000 − 500 = 1500). The card must render the server's effective rate (12%),
// proving the commission arithmetic happens on the server and the client only
// formats what it was handed (launch CLAUDE.md #1: money/rates are never
// computed on the client).
const rebate: Rebate = {
  id: 'inc_reb_test',
  title: 'Lower commission · this week',
  baseBps: 2000,
  reductionBps: 500,
  kind: 'percentage_points',
  effectiveBps: 1200,
  endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  eligible: { used: 14, cap: 30, rebatedSoFar: NGN(217_000) },
  fundedBy: 'UBI',
  appliesTo: 'Not tips, tolls or taxes',
  example: {
    tripRef: 'rd_314',
    fare: NGN(310_000),
    commissionBefore: NGN(62_000),
    commissionAfter: NGN(46_500),
    rebate: NGN(15_500),
    ifPercentOfCommission: NGN(3_100),
  },
};

const wrap = (r: Rebate) =>
  render(
    <ThemeProvider defaultMode="dark">
      <RebateCard r={r} onPress={() => {}} />
    </ThemeProvider>,
  );

describe('RebateCard (base / reduction / effective from server props)', () => {
  it('shows the base rate from baseBps', () => {
    const { getByText } = wrap(rebate);
    expect(getByText('20%')).toBeTruthy();
  });

  it('shows the reduction in points from reductionBps', () => {
    const { getByText } = wrap(rebate);
    expect(getByText(/5 points/)).toBeTruthy();
  });

  it('shows the SERVER effective rate, not a client-computed base − reduction', () => {
    const { getByText, queryByText } = wrap(rebate);
    // effectiveBps = 1200 → "12%" is rendered
    expect(getByText('12%')).toBeTruthy();
    // 2000 − 500 = 1500 → "15%" would appear only if the client did the math
    expect(queryByText('15%')).toBeNull();
  });

  it('honours a percent-of-commission rebate kind without recomputing it', () => {
    const { getByText, queryByText } = wrap({
      ...rebate,
      kind: 'percent_of_commission',
      reductionBps: 500,
      effectiveBps: 1900,
    });
    expect(getByText('19%')).toBeTruthy();
    expect(getByText(/of commission/)).toBeTruthy();
    expect(queryByText('15%')).toBeNull();
  });

  it('reflects server eligibility counts (used of cap)', () => {
    const { getByText } = wrap(rebate);
    expect(getByText(/14 of 30/)).toBeTruthy();
  });
});
