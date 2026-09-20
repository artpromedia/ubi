// Regressions for client-contract findings #8 and the bid-rejection surfacing rule:
//  - a next-slot bid sources its mandatory dependsOnClaimId from the driver-view's
//    currentClaimId (the server's own statement), not from a jobs projection call;
//  - a 4xx on submit shows the SERVER message in a banner — never a silent refetch.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@ubi/mobile-ui';
import { installFixtures } from '@ubi/mobile-core';
import { TEST_IDS, dynamicTestId } from '@ubi/contracts';
import { setMotionForDev, resetMotionForDev } from '../../../lib/motion';
import { RequestDetailContainer } from '../RequestDetailContainer';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { requestId: 'req_next_1' } }),
}));

const money = (amountMinor: number) => ({ amountMinor, currency: 'NGN' });
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

const driverView = () => ({
  item: { requestId: 'req_next_1', revision: 1, service: 'ride', title: 'Lekki → VI', meta: 'Ride · Economy', askedMinor: money(2800_00), askedByLabel: 'rider asks', capabilityBadge: null, expiresAt: iso(120_000) },
  eligibility: { eligible: true, slot: 'next', reasons: [], policyVersion: 3, availabilityEpoch: 7, evaluatedAt: new Date().toISOString() },
  presets: [{ key: 'p1', source: 'requested', amountMinor: money(2800_00), commissionMinor: money(280_00), netMinor: money(2520_00), title: 'Offer ₦2,800', feeNetLabel: 'fee ₦280 · you keep ₦2,520', affordable: true, shortfallMinor: null, shortfallLabel: null, emphasized: true }],
  profileLine: null,
  ceilingNotice: null,
  myBid: null,
  // The server names the driver's current claim right on the driver-view.
  currentClaimId: 'clm_cur_77',
});

const harness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={client}>
        <RequestDetailContainer />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

describe('RequestDetailContainer', () => {
  beforeEach(() => {
    resetMotionForDev();
    act(() => setMotionForDev('parked_confirmed'));
  });

  it('sends driver-view.currentClaimId as dependsOnClaimId on a next-slot bid', async () => {
    const bidBodies: unknown[] = [];
    installFixtures(async ({ method, path, body }) => {
      if (method === 'GET' && path === '/v1/mp/requests/req_next_1/driver-view') return { status: 200, json: driverView() };
      if (method === 'POST' && path === '/v1/mp/bids') {
        bidBodies.push(body);
        return { status: 201, json: { bidId: 'bid_9', requestId: 'req_next_1', requestRevision: 1, bidVersion: 1, state: 'submitted', driverId: 'u_drv', amountMinor: money(2800_00), commissionMinor: money(280_00), netMinor: money(2520_00), slot: 'next', dependsOnClaimId: 'clm_cur_77', reservationId: 'rsv_9', expiresAt: iso(120_000), createdAt: iso(0) } };
      }
      // No GET /v1/mp/driver/jobs handler on purpose: the dependency must not need it.
      return undefined;
    });
    const view = harness();
    fireEvent.press(await screen.findByTestId(dynamicTestId(TEST_IDS.mp.driver.detail.preset, 0)));
    await waitFor(() => expect(bidBodies).toHaveLength(1));
    expect((bidBodies[0] as { dependsOnClaimId?: string }).dependsOnClaimId).toBe('clm_cur_77');
    expect((bidBodies[0] as { slot: string }).slot).toBe('next');
    view.unmount(); // stop the container's 5s refetch interval
  });

  it('surfaces a 4xx rejection with the server message instead of a silent refetch', async () => {
    installFixtures(async ({ method, path }) => {
      if (method === 'GET' && path === '/v1/mp/requests/req_next_1/driver-view') return { status: 200, json: driverView() };
      if (method === 'POST' && path === '/v1/mp/bids') {
        return { status: 422, json: { code: 'queue_dependency_invalid', message: 'dependsOnClaimId must name your current claim' } };
      }
      return undefined;
    });
    const view = harness();
    fireEvent.press(await screen.findByTestId(dynamicTestId(TEST_IDS.mp.driver.detail.preset, 0)));
    expect(await screen.findByText('dependsOnClaimId must name your current claim')).toBeTruthy();
    view.unmount(); // stop the container's 5s refetch interval
  });
});
