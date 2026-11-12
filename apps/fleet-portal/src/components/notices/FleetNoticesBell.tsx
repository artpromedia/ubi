"use client";

import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Loader2,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fleetApi, type FleetApi } from "@/lib/fleet-api";
import type { FleetNoticeItem } from "@/lib/fleet-types";
import { newIdempotencyKey } from "@/lib/idempotency";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";

export type FleetNoticesApi = Pick<
  FleetApi,
  "notices" | "markNoticeRead" | "markAllNoticesRead"
>;

interface FleetNoticesBellProps {
  readonly api?: FleetNoticesApi;
  readonly initialNotices?: readonly FleetNoticeItem[];
  readonly initialUnreadCount?: number;
  readonly initialOpen?: boolean;
}

export function isServiceSoonNotice(item: FleetNoticeItem): boolean {
  const titleLower = item.title.toLowerCase();
  const bodyLower = item.body.toLowerCase();
  return (
    titleLower.includes("requested vehicle service") ||
    titleLower.includes("vehicle service requested") ||
    bodyLower.includes("needs service soon") ||
    bodyLower.includes("plan maintenance")
  );
}

export function isCriticalNotice(item: FleetNoticeItem): boolean {
  const titleLower = item.title.toLowerCase();
  const name = item.data?.name ?? "";
  return (
    titleLower.includes("breakdown") ||
    titleLower.includes("off-road") ||
    titleLower.includes("document expired") ||
    titleLower.includes("deadline passed") ||
    name === "vehicle.document.expired" ||
    name === "fleet.conflict.lapsed"
  );
}

export function primaryLinkForNotice(item: FleetNoticeItem): {
  readonly href: string;
  readonly label: string;
  readonly isPlanMaintenance: boolean;
} | null {
  const vehicleId = item.data?.vehicleId;
  const name = item.data?.name ?? "";

  if (isServiceSoonNotice(item)) {
    return {
      href: vehicleId
        ? `/maintenance/new?vehicleId=${encodeURIComponent(vehicleId)}`
        : "/maintenance/new",
      label: "Plan maintenance",
      isPlanMaintenance: true,
    };
  }

  if (name.startsWith("vehicle.document.") && vehicleId) {
    return {
      href: `/vehicles/${encodeURIComponent(vehicleId)}#documents`,
      label: "Open vehicle documents",
      isPlanMaintenance: false,
    };
  }

  if (
    name.startsWith("fleet.conflict.") ||
    name === "fleet.offroad.reported" ||
    item.title.toLowerCase().includes("breakdown") ||
    item.title.toLowerCase().includes("conflict")
  ) {
    return {
      href: "/conflicts",
      label: "Open Conflict Centre",
      isPlanMaintenance: false,
    };
  }

  if (name.startsWith("assignment.")) {
    return {
      href: "/assignments",
      label: "Open Assignments",
      isPlanMaintenance: false,
    };
  }

  if (name === "fleet.staff.changed") {
    return {
      href: "/staff",
      label: "Open Staff & roles",
      isPlanMaintenance: false,
    };
  }

  return null;
}

export const FleetNoticesBell = ({
  api = fleetApi,
  initialNotices = [],
  initialUnreadCount,
  initialOpen = false,
}: FleetNoticesBellProps) => {
  const [open, setOpen] = useState(initialOpen);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] =
    useState<readonly FleetNoticeItem[]>(initialNotices);
  const [unreadCount, setUnreadCount] = useState(
    initialUnreadCount ??
      initialNotices.filter((item) => item.readAt === null).length,
  );
  const [loading, setLoading] = useState(initialNotices.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotices = useCallback(async () => {
    setError(null);
    try {
      const res = await api.notices({ limit: 25 });
      setItems(res.notifications ?? []);
      setUnreadCount(
        typeof res.unreadCount === "number"
          ? res.unreadCount
          : (res.notifications ?? []).filter((n) => n.readAt === null).length,
      );
    } catch {
      setError("Could not load fleet notices right now.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadNotices();
  }, [loadNotices]);

  const handleMarkRead = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await api.markNoticeRead(id, newIdempotencyKey());
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
            : item,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      setError("Could not mark notice as read.");
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkAllRead = async (): Promise<void> => {
    setMarkingAll(true);
    try {
      await api.markAllNoticesRead(newIdempotencyKey());
      const nowIso = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) => ({ ...item, readAt: item.readAt ?? nowIso })),
      );
      setUnreadCount(0);
    } catch {
      setError("Could not mark all notices as read.");
    } finally {
      setMarkingAll(false);
    }
  };

  const visibleItems = unreadOnly
    ? items.filter((item) => item.readAt === null)
    : items;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Fleet notices"
        aria-expanded={open}
        data-testid={FLEET_ACCOUNT_TEST_IDS.notices.bell}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            void loadNotices();
          }
        }}
        className="relative inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
      >
        <Bell className="h-3.5 w-3.5 text-zinc-300" aria-hidden />
        <span>Notices</span>
        {unreadCount > 0 ? (
          <span
            data-testid={FLEET_ACCOUNT_TEST_IDS.notices.unreadBadge}
            className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[#1DB954] px-1.5 py-0.5 text-[10px] font-bold text-black"
          >
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Fleet notices drawer"
          data-testid={FLEET_ACCOUNT_TEST_IDS.notices.drawer}
          className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-700 bg-[#141414] p-4 shadow-2xl z-50 space-y-3"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Fleet notices
              </h2>
              <p className="text-[11px] text-zinc-400">
                {unreadCount === 0
                  ? "All caught up"
                  : `${unreadCount} unread notice${unreadCount === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  disabled={markingAll}
                  onClick={() => {
                    void handleMarkAllRead();
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  <CheckCheck className="h-3 w-3" aria-hidden />
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close notices"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setUnreadOnly(false)}
              className={`rounded-md px-2.5 py-1 font-medium ${
                !unreadOnly
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setUnreadOnly(true)}
              className={`rounded-md px-2.5 py-1 font-medium ${
                unreadOnly
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {error ? (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading notices…
            </div>
          ) : visibleItems.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-400">
              {unreadOnly
                ? "No unread fleet notices."
                : "No fleet notices yet."}
            </p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {visibleItems.map((item) => {
                const isUnread = item.readAt === null;
                const critical = isCriticalNotice(item);
                const serviceSoon = isServiceSoonNotice(item);
                const actionLink = primaryLinkForNotice(item);

                return (
                  <li
                    key={item.id}
                    data-testid={FLEET_ACCOUNT_TEST_IDS.notices.item}
                    className={`rounded-lg border p-3 text-xs space-y-2 ${
                      critical
                        ? "border-red-500/40 bg-red-500/10"
                        : serviceSoon
                          ? "border-amber-500/40 bg-amber-500/10"
                          : isUnread
                            ? "border-zinc-700 bg-zinc-900/90"
                            : "border-zinc-800 bg-[#0F0F0F] opacity-80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-zinc-100">
                        {critical ? (
                          <AlertTriangle
                            className="h-3.5 w-3.5 shrink-0 text-red-400"
                            aria-hidden
                          />
                        ) : serviceSoon ? (
                          <Wrench
                            className="h-3.5 w-3.5 shrink-0 text-amber-300"
                            aria-hidden
                          />
                        ) : null}
                        <span>{item.title}</span>
                      </div>
                      {isUnread ? (
                        <span className="shrink-0 rounded-full bg-[#1DB954]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#86EFAC]">
                          New
                        </span>
                      ) : null}
                    </div>

                    <p className="text-zinc-300 leading-relaxed">{item.body}</p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      {actionLink ? (
                        <Link
                          href={actionLink.href}
                          data-testid={
                            actionLink.isPlanMaintenance
                              ? FLEET_ACCOUNT_TEST_IDS.notices.planMaintenance
                              : undefined
                          }
                          onClick={() => setOpen(false)}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                            actionLink.isPlanMaintenance
                              ? "bg-[#1DB954] text-black hover:bg-[#19a349]"
                              : "border border-zinc-600 text-zinc-100 hover:bg-zinc-800"
                          }`}
                        >
                          {actionLink.label}
                        </Link>
                      ) : (
                        <span />
                      )}

                      {isUnread ? (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => {
                            void handleMarkRead(item.id);
                          }}
                          className="text-[11px] text-zinc-400 hover:text-zinc-100 disabled:opacity-50"
                        >
                          {busyId === item.id ? "Saving…" : "Mark read"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
};
