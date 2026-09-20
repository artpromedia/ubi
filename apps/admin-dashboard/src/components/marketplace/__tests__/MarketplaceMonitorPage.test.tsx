/**
 * Component tests via react-dom/server (no @testing-library dep exists in this
 * repo, so we assert on static markup: rows, states, and mp.admin.* testids).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  MarketplaceMonitorPage,
  type MonitorRow,
  type MonitorStat,
  type TimelineEvent,
} from '../MarketplaceMonitorPage';

const stats: MonitorStat[] = [
  { label: 'Open requests', value: '4', detail: '1 without bids', tone: 'warn' },
  { label: 'Award pending', value: '2', tone: 'danger' },
];
const rows: MonitorRow[] = [
  { requestId: 'req_001', route: 'lagos', service: 'ride', asked: '₦2,500', bids: 3, reach: '17', envelope: '2.0 km · 6 min · step 1', state: 'open' },
  { requestId: 'req_002', route: 'lagos', service: 'delivery', asked: '₦1,200', bids: 0, reach: '5', envelope: '3.5 km · 9 min · step 2', state: 'no_bids' },
  { requestId: 'req_003', route: 'abuja', service: 'ride', asked: '₦4,000', bids: 5, reach: '22', envelope: '2.0 km · 6 min · step 1', state: 'award_pending' },
  { requestId: 'req_004', route: 'abuja', service: 'ride', asked: '₦3,100', bids: 4, reach: '9', envelope: '—', state: 'awarded' },
];
const events: TimelineEvent[] = [
  { at: '10:02:11', type: 'mp.request.published', tone: 'info', detail: 'v1 published' },
  { at: '10:03:40', type: 'mp.bid.submitted', tone: 'info', detail: 'driver bid ₦2,400' },
  { at: '10:05:02', type: 'mp.bid.expired', tone: 'warn', detail: 'bid expired' },
  { at: '10:07:19', type: 'mp.award.confirmed', tone: 'ok', detail: 'award confirmed' },
];

describe('MarketplaceMonitorPage', () => {
  it('renders the monitor table testid, stat cards and one row per request', () => {
    const html = renderToStaticMarkup(
      <MarketplaceMonitorPage stats={stats} rows={rows} timeline={null} onOpenCase={() => undefined} />,
    );
    expect(html).toContain('data-testid="mp.admin.monitor.table"');
    expect(html).toContain('Open requests');
    expect(html).toContain('1 without bids');
    for (const r of rows) {
      expect(html).toContain(r.requestId);
    }
    expect(html).toContain('₦2,500');
  });

  it('renders every state pill label', () => {
    const html = renderToStaticMarkup(
      <MarketplaceMonitorPage stats={[]} rows={rows} timeline={null} onOpenCase={() => undefined} />,
    );
    expect(html).toContain('Open');
    expect(html).toContain('Open · no bids');
    expect(html).toContain('Award pending');
    expect(html).toContain('Awarded');
  });

  it('renders no timeline card when timeline is null', () => {
    const html = renderToStaticMarkup(
      <MarketplaceMonitorPage stats={[]} rows={[]} timeline={null} onOpenCase={() => undefined} />,
    );
    expect(html).not.toContain('mp.admin.timeline.');
  });

  it('renders the append-only timeline with per-request testid, events and no mutation controls', () => {
    const html = renderToStaticMarkup(
      <MarketplaceMonitorPage
        stats={[]}
        rows={[]}
        timeline={{ requestId: 'req_001', policyLine: 'policy v3', events }}
        onOpenCase={() => undefined}
      />,
    );
    expect(html).toContain('data-testid="mp.admin.timeline.req_001"');
    expect(html).toContain('policy v3');
    for (const e of events) {
      expect(html).toContain(e.type);
      expect(html).toContain(e.detail);
    }
    // Append-only: the only button is navigation to the full case.
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons.length).toBe(1);
    expect(html).toContain('Open full case');
  });
});
