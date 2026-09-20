// Regressions for two contract alignments:
//  - walletOverview must pass the market's cityId as a query param
//    (GET /v1/wallet/mp/overview?cityId=…, per contracts/openapi/marketplace.yaml);
//  - a rejected submit/revise must surface the server's message verbatim
//    (queue_dependency_invalid, insufficient_spendable, …), never vanish into a
//    silent refetch.
import { installFixtures, ApiError } from '@ubi/mobile-core';
import { marketplaceApi } from '../marketplace';
import { bidRejection } from '../../screens/marketplace/RequestDetailContainer';

describe('marketplaceApi.walletOverview', () => {
  it('sends cityId as a query parameter when the city config names one', async () => {
    const paths: string[] = [];
    installFixtures(async ({ method, path }) => {
      if (method === 'GET' && path.startsWith('/v1/wallet/mp/overview')) {
        paths.push(path);
        return { status: 200, json: { clearedMinor: { amountMinor: 0, currency: 'NGN' }, heldMinor: { amountMinor: 0, currency: 'NGN' }, spendableMinor: { amountMinor: 0, currency: 'NGN' }, holds: [] } };
      }
      return undefined;
    });
    await marketplaceApi.walletOverview('LOS');
    expect(paths).toEqual(['/v1/wallet/mp/overview?cityId=LOS']);
  });
  it('omits the param when no city is known yet', async () => {
    const paths: string[] = [];
    installFixtures(async ({ method, path }) => {
      if (method === 'GET' && path.startsWith('/v1/wallet/mp/overview')) {
        paths.push(path);
        return { status: 200, json: { clearedMinor: { amountMinor: 0, currency: 'NGN' }, heldMinor: { amountMinor: 0, currency: 'NGN' }, spendableMinor: { amountMinor: 0, currency: 'NGN' }, holds: [] } };
      }
      return undefined;
    });
    await marketplaceApi.walletOverview();
    expect(paths).toEqual(['/v1/wallet/mp/overview']);
  });
});

describe('bidRejection (submit/revise 4xx surfacing)', () => {
  it('carries the server message verbatim for queue_dependency_invalid', () => {
    const e = new ApiError(422, 'queue_dependency_invalid', 'dependsOnClaimId must name your current claim');
    expect(bidRejection(e)).toEqual({ title: 'Your offer wasn’t placed', detail: 'dependsOnClaimId must name your current claim' });
  });
  it('carries the server message for any other 4xx code', () => {
    const e = new ApiError(409, 'version_conflict', 'This request changed — review the new terms before bidding.');
    expect(bidRejection(e).detail).toBe('This request changed — review the new terms before bidding.');
  });
  it('still yields an honest banner for non-API failures', () => {
    expect(bidRejection(new Error('Network request failed')).detail).toBe('Network request failed');
    expect(bidRejection('??').detail).toContain('refreshed');
  });
});
