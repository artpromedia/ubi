import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  FleetNoticesBell,
  isCriticalNotice,
  isServiceSoonNotice,
  primaryLinkForNotice,
} from "./FleetNoticesBell";
import { createFleetApi } from "@/lib/fleet-api";
import type { FleetNoticeItem } from "@/lib/fleet-types";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";

const SAMPLE_NOTICES: FleetNoticeItem[] = [
  {
    id: "ntf_service_soon",
    userId: "usr_owner_1",
    type: "GENERAL",
    title: "Driver requested vehicle service",
    body: "A driver reported that a fleet vehicle needs service soon. Open the Fleet Portal to plan maintenance.",
    data: {
      kind: "fleet",
      name: "fleet.alert",
      fleetId: "flt_1",
      vehicleId: "veh_42",
    },
    readAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "ntf_breakdown",
    userId: "usr_owner_1",
    type: "GENERAL",
    title: "Driver reported a breakdown",
    body: "A driver reported that a fleet vehicle cannot be driven. Open the Fleet Portal to arrange cover or a vehicle swap.",
    data: {
      kind: "fleet",
      name: "fleet.alert",
      fleetId: "flt_1",
      vehicleId: "veh_99",
    },
    readAt: null,
    createdAt: "2026-10-01T09:30:00.000Z",
  },
];

describe("FleetNoticesBell (CC-C05 / P1-06)", () => {
  it("renders unread count badge, notices drawer, and persistent Plan maintenance CTA for service-soon notices", () => {
    const html = renderToStaticMarkup(
      <FleetNoticesBell
        initialNotices={SAMPLE_NOTICES}
        initialUnreadCount={2}
        initialOpen
      />,
    );

    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.notices.bell}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.notices.unreadBadge}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.notices.drawer}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.notices.item}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.notices.planMaintenance}"`,
    );
    expect(html).toContain('href="/maintenance/new?vehicleId=veh_42"');
    expect(html).toContain("Plan maintenance");
    expect(html).toContain("Open Conflict Centre");
  });

  it("classifies service-soon vs critical breakdown notices and routes each to the right portal screen", () => {
    expect(isServiceSoonNotice(SAMPLE_NOTICES[0]!)).toBe(true);
    expect(isCriticalNotice(SAMPLE_NOTICES[0]!)).toBe(false);
    expect(primaryLinkForNotice(SAMPLE_NOTICES[0]!)).toEqual({
      href: "/maintenance/new?vehicleId=veh_42",
      label: "Plan maintenance",
      isPlanMaintenance: true,
    });

    expect(isServiceSoonNotice(SAMPLE_NOTICES[1]!)).toBe(false);
    expect(isCriticalNotice(SAMPLE_NOTICES[1]!)).toBe(true);
    expect(primaryLinkForNotice(SAMPLE_NOTICES[1]!)).toEqual({
      href: "/conflicts",
      label: "Open Conflict Centre",
      isPlanMaintenance: false,
    });
  });

  it("calls /v1/notifications, /v1/notifications/:id/read, and /v1/notifications/read-all through fleetApi", async () => {
    const get = vi.fn(async () => ({
      success: true,
      data: {
        notifications: SAMPLE_NOTICES,
        unreadCount: 2,
      },
    }));
    const patch = vi.fn(async () => ({
      success: true,
      data: {
        notification: { ...SAMPLE_NOTICES[0]!, readAt: "2026-10-01T10:05:00Z" },
      },
    }));
    const post = vi.fn(async () => ({
      success: true,
      data: { markedAsRead: 2 },
    }));

    const api = createFleetApi({
      get: get as never,
      post: post as never,
      put: vi.fn() as never,
      patch: patch as never,
      delete: vi.fn() as never,
    });

    const list = await api.notices({ limit: 25, unreadOnly: true });
    expect(get).toHaveBeenCalledWith(
      "/v1/notifications?limit=25&unreadOnly=true",
      { signal: undefined },
    );
    expect(list.unreadCount).toBe(2);

    const marked = await api.markNoticeRead("ntf_service_soon", "idem_read_1");
    expect(patch).toHaveBeenCalledWith(
      "/v1/notifications/ntf_service_soon/read",
      {},
      { idempotencyKey: "idem_read_1" },
    );
    expect(marked.notification.readAt).toBe("2026-10-01T10:05:00Z");

    const allMarked = await api.markAllNoticesRead("idem_read_all_1");
    expect(post).toHaveBeenCalledWith(
      "/v1/notifications/read-all",
      {},
      { idempotencyKey: "idem_read_all_1" },
    );
    expect(allMarked.markedAsRead).toBe(2);
  });
});
