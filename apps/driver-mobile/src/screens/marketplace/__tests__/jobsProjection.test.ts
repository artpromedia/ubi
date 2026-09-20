// Regression for client-contract finding #8: GET /v1/mp/driver/jobs is a REAL
// endpoint serving the OpenAPI DriverJob schema (claimId, slot, service, state,
// fareMinor, commissionMinor, receiptId?, executionRef?, pickupWindow?). The Jobs
// screen maps THAT shape — not the old fixture-only card projection with
// statusSuffix/title/feeLine/tripId fields the server never sends.
import type { MpDriverJob } from '../../../api/marketplace';
import { jobCard } from '../JobsTimelineContainer';

const driverJob = (over: Partial<MpDriverJob> = {}): MpDriverJob => ({
  claimId: 'clm_cur',
  slot: 'current',
  service: 'ride',
  state: 'in trip',
  fareMinor: { amountMinor: 3200_00, currency: 'NGN' },
  commissionMinor: { amountMinor: 320_00, currency: 'NGN' },
  receiptId: 'rcpt_mp_00287',
  executionRef: { service: 'ride', id: 'ride_mp_901' },
  pickupWindow: null,
  ...over,
});

describe('jobCard (DriverJob → JobCard projection)', () => {
  it('maps the contract DriverJob fields the screen renders', () => {
    const card = jobCard(driverJob());
    expect(card.claimId).toBe('clm_cur');
    expect(card.slot).toBe('current');
    // Old behavior read c.statusSuffix / c.title / c.feeLine straight off the
    // payload — all undefined against the real server.
    expect(card.statusSuffix).toBe('in trip');
    expect(card.title).toContain('Ride');
    expect(card.title).not.toContain('undefined');
    expect(card.fareMinor).toEqual({ amountMinor: 3200_00, currency: 'NGN' });
    expect(card.feeLine).toContain('rcpt_mp_00287');
    expect(card.feeReceiptId).toBe('rcpt_mp_00287');
  });
  it('formats the pickup window into the detail line and tolerates a missing receipt', () => {
    const card = jobCard(driverJob({ slot: 'next', state: 'queued', receiptId: null, executionRef: null, pickupWindow: { earliestSec: 720, latestSec: 1080, etaVersion: 3 } }));
    expect(card.detail).toContain('12–18 min');
    expect(card.feeReceiptId).toBe('');
    expect(card.remainingLabel).toBeNull();
  });
});
