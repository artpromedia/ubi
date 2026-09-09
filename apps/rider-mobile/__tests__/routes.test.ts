import { linking } from '../src/navigation/linking';
import { routeAssertions } from '../src/__typetests__/routes.assert';

// The param-list typing itself is proven at compile time by
// src/__typetests__/routes.assert.ts (checked by `tsc --noEmit`). Here we assert
// the runtime deep-link surface that mirrors the Flutter go_router paths, plus
// that the compile-time assertions were part of this build.

describe('typed deep-link routes', () => {
  it('carries the ubi.africa prefixes', () => {
    expect(linking.prefixes).toContain('ubi://');
    expect(linking.prefixes).toContain('https://ubi.africa');
  });

  it('maps the Ask paths', () => {
    const screens = linking.config!.screens as Record<string, any>;
    expect(screens.Ask.screens.Thread).toBe('ask');
    expect(screens.Ask.screens.Execution).toBe('ask/executions/:executionId');
  });

  it('maps the Travel paths that existing links depend on', () => {
    const screens = linking.config!.screens as Record<string, any>;
    expect(screens.Travel.screens.FlightResults).toBe('travel/flights/:searchId');
    expect(screens.Travel.screens.OrderStatus).toBe('travel/orders/:orderId');
    expect(screens.Travel.screens.Disruption).toBe('travel/orders/:orderId/disruption');
    expect(screens.Travel.screens.RefundStatus).toBe('travel/refunds/:refundId');
  });

  it('includes the compile-time route/param assertions in the build', () => {
    expect(routeAssertions).toBe(true);
  });
});
