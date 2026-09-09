import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import { IncentiveStrip } from '../IncentiveStrip';

const wrap = (ui: React.ReactElement) =>
  render(<ThemeProvider defaultMode="dark">{ui}</ThemeProvider>);

describe('IncentiveStrip', () => {
  // Board 22c: the strip is a read-only glance while online. It prints exactly
  // what the server put on the wire (badge / headline / detail) and does no
  // arithmetic of its own — the "0%", trip counts and money are already resolved
  // server-side.
  const strip = {
    badge: '0%',
    headline: 'Commission-free until 22:00 · 3 of 10 trips used',
    detail: 'Cap ₦5,000 saved · ₦1,640 so far',
  };

  it('renders the server-computed badge, headline and detail verbatim', () => {
    const { getByTestId, getByText } = wrap(<IncentiveStrip strip={strip} />);
    expect(getByTestId(TID.driver.home.incentiveStrip)).toBeTruthy();
    expect(getByText(strip.badge)).toBeTruthy();
    expect(getByText(strip.headline)).toBeTruthy();
    expect(getByText(strip.detail)).toBeTruthy();
  });

  it('exposes an aria-live label combining headline and detail for screen readers', () => {
    const { getByTestId } = wrap(<IncentiveStrip strip={strip} />);
    const node = getByTestId(TID.driver.home.incentiveStrip);
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    expect(node.props.accessibilityLabel).toBe(strip.headline + '. ' + strip.detail);
  });

  it('renders nothing when the server sent no strip (null)', () => {
    const { queryByTestId, toJSON } = wrap(<IncentiveStrip strip={null} />);
    expect(queryByTestId(TID.driver.home.incentiveStrip)).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when the strip is absent (undefined)', () => {
    const { queryByTestId } = wrap(<IncentiveStrip strip={undefined} />);
    expect(queryByTestId(TID.driver.home.incentiveStrip)).toBeNull();
  });
});
