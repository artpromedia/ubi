import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider, FlagGate } from '@ubi/mobile-ui';
import { FlagsProvider, installFixtures, TID } from '@ubi/mobile-core';

// Drives the real FlagsProvider through the src/api boundary. installFixtures
// registers a handler for the flags endpoint (dev-only path; __DEV__ is true
// under the RN jest preset), so the gate is exercised end to end with no network
// and no personas/prices baked into the screen.
function setFlags(map: Record<string, boolean> | 'unreachable') {
  installFixtures(async ({ path }) => {
    if (path.startsWith('/v1/config/flags')) {
      if (map === 'unreachable') return { status: 503, json: { code: 'unavailable', message: 'down' } };
      return { status: 200, json: map };
    }
    return undefined;
  });
}

const Gated = ({ cityId }: { cityId?: string }) => (
  <ThemeProvider defaultMode="dark">
    <FlagsProvider cityId={cityId}>
      <FlagGate flag="driver_commission_rebates" featureName="Incentives" onDismiss={() => {}}>
        <Text>GATED CONTENT</Text>
      </FlagGate>
    </FlagsProvider>
  </ThemeProvider>
);

describe('FlagGate — driver commission-rebates gating', () => {
  it('renders the feature when the city has driver_commission_rebates on', async () => {
    setFlags({ driver_commission_rebates: true });
    render(<Gated cityId="LOS" />);
    expect(await screen.findByText('GATED CONTENT')).toBeTruthy();
    expect(screen.queryByTestId(TID.common.flagOff.screen)).toBeNull();
  });

  it('shows the honest "not available here" screen when the server says the flag is off', async () => {
    setFlags({ driver_commission_rebates: false });
    render(<Gated cityId="LOS" />);
    expect(await screen.findByTestId(TID.common.flagOff.screen)).toBeTruthy();
    expect(screen.queryByText('GATED CONTENT')).toBeNull();
  });

  it('denies by default when the config service is unreachable (never fails open)', async () => {
    setFlags('unreachable');
    render(<Gated cityId="LOS" />);
    expect(await screen.findByTestId(TID.common.flagOff.screen)).toBeTruthy();
    expect(screen.queryByText('GATED CONTENT')).toBeNull();
  });

  it('denies when there is no city yet (no flag context to trust)', async () => {
    render(<Gated cityId={undefined} />);
    expect(await screen.findByTestId(TID.common.flagOff.screen)).toBeTruthy();
    expect(screen.queryByText('GATED CONTENT')).toBeNull();
  });
});
