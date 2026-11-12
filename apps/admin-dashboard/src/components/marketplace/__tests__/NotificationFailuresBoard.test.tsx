import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type DlqItemView } from "@/lib/marketplace-api";
import { NotificationFailuresBoard } from "../NotificationFailuresBoard";

const SAMPLE_ITEMS: DlqItemView[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    queue: "marketplace",
    status: "pending",
    eventId: "evt-mp-001",
    eventName: "fleet.conflict.opened",
    userId: "usr-fleet-owner-1",
    role: "fleet_owner",
    channel: "push",
    attempts: 4,
    reason: "provider_5xx",
    tokenId: null,
    requestId: null,
    maskedPhone: null,
    subjectType: "vehicle",
    subjectId: "veh-lag-99",
    cityId: "lagos",
    replayable: true,
    at: "2026-11-11T09:00:00Z",
    replayedAt: null,
    replayedBy: null,
    replayOutcome: null,
    discardedAt: null,
    discardedBy: null,
    discardReason: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    queue: "trip_access",
    status: "pending",
    eventId: "evt-ta-002",
    eventName: "ride.trip_access_link.issued",
    userId: null,
    role: "guest_passenger",
    channel: "sms",
    attempts: 3,
    reason: "sms_gateway_timeout",
    tokenId: "tok-ta-002",
    requestId: "req-lag-55",
    maskedPhone: "•••4567",
    subjectType: "ride_request",
    subjectId: "req-lag-55",
    cityId: "lagos",
    replayable: true,
    at: "2026-11-11T09:05:00Z",
    replayedAt: null,
    replayedBy: null,
    replayOutcome: null,
    discardedAt: null,
    discardedBy: null,
    discardReason: null,
  },
];

describe("NotificationFailuresBoard (P2-04)", () => {
  it("renders loading and empty states cleanly without fabricated rows", () => {
    const loadingHtml = renderToStaticMarkup(
      <NotificationFailuresBoard loading />,
    );
    expect(loadingHtml).toContain('data-testid="admin.dlq.board"');
    expect(loadingHtml).toContain('data-testid="admin.dlq.loading"');
    expect(loadingHtml).not.toContain('data-testid="admin.dlq.row"');

    const emptyHtml = renderToStaticMarkup(
      <NotificationFailuresBoard items={[]} />,
    );
    expect(emptyHtml).toContain('data-testid="admin.dlq.empty"');
    expect(emptyHtml).not.toContain('data-testid="admin.dlq.row"');
  });

  it("renders sanitized marketplace and trip_access DLQ rows with replay, discard, and detail inspection", () => {
    const html = renderToStaticMarkup(
      <NotificationFailuresBoard
        items={SAMPLE_ITEMS}
        counts={{
          marketplace: 1,
          tripAccess: 1,
          pending: 2,
          replayed: 5,
          discarded: 1,
        }}
        selectedId={SAMPLE_ITEMS[1]!.id}
        selectedBulkIds={[SAMPLE_ITEMS[0]!.id]}
      />,
    );

    expect(html).toContain('data-testid="admin.dlq.queueTabs"');
    expect(html).toContain("notif:mp:dlq");
    expect(html).toContain("notif:trip_access:dlq");
    expect(html).toContain('data-testid="admin.dlq.row"');
    expect(html).toContain("fleet.conflict.opened");
    expect(html).toContain("ride.trip_access_link.issued");
    expect(html).toContain("•••4567");
    expect(html).not.toContain("+23480");
    expect(html).toContain('data-testid="admin.dlq.replay"');
    expect(html).toContain('data-testid="admin.dlq.discard"');
    expect(html).toContain('data-testid="admin.dlq.bulkReplay"');
    expect(html).toContain('data-testid="admin.dlq.detail"');
    expect(html).toContain("Sanitized DLQ Entry Detail");
  });

  it("requires an operator reason (>= 3 chars) before confirming a DLQ discard", () => {
    const blockedHtml = renderToStaticMarkup(
      <NotificationFailuresBoard
        items={SAMPLE_ITEMS}
        activeCommand={{
          kind: "discard",
          targetId: SAMPLE_ITEMS[0]!.id,
          phase: "confirm",
        }}
        discardReason="no"
      />,
    );
    expect(blockedHtml).toContain('data-testid="admin.dlq.reason"');
    expect(blockedHtml).toContain(
      'data-testid="admin.dlq.confirm" disabled=""',
    );

    const readyHtml = renderToStaticMarkup(
      <NotificationFailuresBoard
        items={SAMPLE_ITEMS}
        activeCommand={{
          kind: "discard",
          targetId: SAMPLE_ITEMS[0]!.id,
          phase: "confirm",
        }}
        discardReason="Trip already completed and rider notified"
      />,
    );
    expect(readyHtml).toContain('data-testid="admin.dlq.confirm"');
    expect(readyHtml).not.toContain(
      'data-testid="admin.dlq.confirm" disabled=""',
    );
  });
});
