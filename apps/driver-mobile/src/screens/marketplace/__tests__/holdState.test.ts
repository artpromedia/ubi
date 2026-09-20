// Regression for client-contract finding #5: the server's holdState vocabulary is
// held | release_pending | released (released ONLY after financial confirmation).
// Any other value — including ride-service's internal machine vocabulary
// 'active' / 'captured' / old servers / shape drift — is UNKNOWN and must render
// the safe pending state, never a truthy passthrough and never 'released'.
import type { MpBidDto } from '../../../api/marketplace';
import { bidRow, holdStateOrSafe } from '../RequestFeedContainer';

const baseBid = (over: Partial<MpBidDto> & { state: MpBidDto['state'] }): MpBidDto => ({
  bidId: 'bid_1',
  requestId: 'req_1',
  requestRevision: 1,
  bidVersion: 1,
  driverId: 'u_drv_1',
  amountMinor: { amountMinor: 2800_00, currency: 'NGN' },
  commissionMinor: { amountMinor: 280_00, currency: 'NGN' },
  netMinor: { amountMinor: 2520_00, currency: 'NGN' },
  slot: 'current',
  dependsOnClaimId: null,
  reservationId: 'rsv_1',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  ...over,
});

describe('holdStateOrSafe', () => {
  it('passes through the three known values', () => {
    expect(holdStateOrSafe('held', 'release_pending')).toBe('held');
    expect(holdStateOrSafe('release_pending', 'held')).toBe('release_pending');
    expect(holdStateOrSafe('released', 'release_pending')).toBe('released');
  });
  it('maps every unknown value to the given safe state, never released', () => {
    for (const v of ['active', 'captured', 'RELEASED', '', 0, true, {}, undefined, null]) {
      expect(holdStateOrSafe(v, 'release_pending')).toBe('release_pending');
      expect(holdStateOrSafe(v, 'held')).toBe('held');
    }
  });
});

describe('bidRow holdState mapping', () => {
  it("renders a live bid with machine-vocabulary holdState 'active' as held, not released", () => {
    // Old behavior: `b.holdState ?? fallback` passed 'active' through and the
    // screen rendered any non-held/non-pending value as "released ·" in ok tone.
    const row = bidRow(baseBid({ state: 'submitted', holdState: 'active' as never }));
    expect(row?.holdState).toBe('held');
  });
  it("renders a lost bid with unknown holdState as release_pending — released needs financial confirmation", () => {
    const row = bidRow(baseBid({ state: 'lost', holdState: 'released_maybe' as never }));
    expect(row?.holdState).toBe('release_pending');
  });
  it('keeps a server-confirmed released hold as released', () => {
    const row = bidRow(baseBid({ state: 'lost', holdState: 'released' }));
    expect(row?.holdState).toBe('released');
  });
  it('defaults an awaiting bid without holdState to held and a closed one to release_pending', () => {
    expect(bidRow(baseBid({ state: 'submitted' }))?.holdState).toBe('held');
    expect(bidRow(baseBid({ state: 'expired' }))?.holdState).toBe('release_pending');
  });
});
