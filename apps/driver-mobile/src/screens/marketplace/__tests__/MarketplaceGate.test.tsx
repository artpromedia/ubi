import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@ubi/mobile-ui';
import { FlagsProvider, installFixtures, TID } from '@ubi/mobile-core';
import { MarketplaceGate } from '../MarketplaceGate';

// Same approach as FlagGate.test.tsx: drive the real FlagsProvider through the src/api
// boundary. The marketplace gate opens when EITHER city-scoped service flag is on
// (rides and delivery roll out independently) and fails closed on everything else.
function setFlags(map: Record<string, boolean> | 'unreachable') {
  installFixtures(async ({ path }) => {
    if (path.startsWith('/v1/config/flags')) {
      if (map === 'unreachable') return { status: 503, json: { code: 'unavailable', message: 'down' } };
      return { status: 200, json: map };
    }
    return undefined;
  });
}

const Gated = () => (
  <ThemeProvider defaultMode="dark">
    <FlagsProvider cityId="LOS">
      <MarketplaceGate featureName="Requests" onDismiss={() => {}}>
        <Text>MARKETPLACE CONTENT</Text>
      </MarketplaceGate>
    </FlagsProvider>
  </ThemeProvider>
);

describe('MarketplaceGate — deny-by-default across both service flags', () => {
  it('opens when only marketplace_rides is on', async () => {
    setFlags({ marketplace_rides: true, marketplace_delivery: false });
    render(<Gated />);
    expect(await screen.findByText('MARKETPLACE CONTENT')).toBeTruthy();
  });

  it('opens when only marketplace_delivery is on', async () => {
    setFlags({ marketplace_rides: false, marketplace_delivery: true });
    render(<Gated />);
    expect(await screen.findByText('MARKETPLACE CONTENT')).toBeTruthy();
  });

  it('shows the honest flag-off screen when both are off', async () => {
    setFlags({ marketplace_rides: false, marketplace_delivery: false });
    render(<Gated />);
    expect(await screen.findByTestId(TID.common.flagOff.screen)).toBeTruthy();
    expect(screen.queryByText('MARKETPLACE CONTENT')).toBeNull();
  });

  it('denies when the flag service is unreachable (never fails open)', async () => {
    setFlags('unreachable');
    render(<Gated />);
    expect(await screen.findByTestId(TID.common.flagOff.screen)).toBeTruthy();
    expect(screen.queryByText('MARKETPLACE CONTENT')).toBeNull();
  });
});
