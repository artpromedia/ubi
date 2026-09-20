/**
 * Component tests via react-dom/server (no @testing-library dep exists in this
 * repo, so we assert on static markup: fields, invalid states, testids).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PolicyEditorPage, type PolicyEditorProps } from '../PolicyEditorPage';

const base: PolicyEditorProps = {
  scopeLine: 'Marketplace policy · lagos',
  activeVersion: 'config v7 · policy v3',
  bounds: [
    { label: 'ride:go', value: 'floor ₦1,200 · cost ₦900 · 60%–150%', mono: true },
    { label: 'delivery:moto', value: 'floor ₦800 · cost ₦600 · 60%–150%', mono: true },
  ],
  boundsError: null,
  presets: [{ label: 'Bid expiry', value: '2 min' }],
  envelopes: [{ label: 'Radius', value: '2.0 → 6.0 km' }],
  previewLine: null,
  audit: [{ version: 'v7', line: 'raise moto floor · by ada · approved by chidi' }],
  roleLine: 'Publishing requires a second approver.',
  killSwitchScope: 'Stops NEW awards only.',
  canPublish: true,
  onSaveDraft: () => undefined,
  onPublish: () => undefined,
  onStopAwards: () => undefined,
};

describe('PolicyEditorPage', () => {
  it('renders the commission row read-only as 10% · 1,000 bps · Fixed with no input', () => {
    const html = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(html).toContain('Marketplace commission');
    expect(html).toContain('10% · 1,000 bps');
    expect(html).toContain('Fixed · not editable');
    expect(html).not.toContain('<input');
  });

  it('renders bounds, presets, envelopes and audit entries', () => {
    const html = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(html).toContain('ride:go');
    expect(html).toContain('delivery:moto');
    expect(html).toContain('Bid expiry');
    expect(html).toContain('2.0 → 6.0 km');
    expect(html).toContain('data-testid="mp.admin.policy.audit"');
    expect(html).toContain('raise moto floor');
  });

  it('enables publish only when canPublish (fail closed on unconfigured floors)', () => {
    const ok = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(ok).toContain('data-testid="mp.admin.policy.publish"');
    expect(ok).not.toMatch(/data-testid="mp\.admin\.policy\.publish" disabled/);

    const blocked = renderToStaticMarkup(
      <PolicyEditorPage
        {...base}
        canPublish={false}
        bounds={[{ label: 'ride:go', value: 'Floor unconfigured', invalid: true }]}
        boundsError="1 service:vehicleClass pair(s) have unconfigured floors — publish is blocked (fail closed)."
      />,
    );
    expect(blocked).toMatch(/data-testid="mp\.admin\.policy\.publish" disabled/);
    expect(blocked).toContain('border-red-500');
    expect(blocked).toContain('publish is blocked (fail closed)');
  });

  it('renders the kill switch button with its testid and scope note', () => {
    const html = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(html).toContain('data-testid="mp.admin.policy.stopAwards"');
    expect(html).toContain('Stop new awards');
    expect(html).toContain('Stops NEW awards only.');
  });
});
