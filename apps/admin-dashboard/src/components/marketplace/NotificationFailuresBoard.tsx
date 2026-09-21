"use client";
import React from "react";

/**
 * C08 — notification-failure board. Honestly gated: notification-service's
 * DLQ (`notif:mp:dlq`) and pending (`notif:mp:pending`) sets are real
 * (services/notification-service/src/marketplace/consumer.ts) but are
 * internal Redis state with no admin-reachable read anywhere in the system
 * today. This board says so plainly instead of fabricating rows, and names
 * the exact endpoint that would close the gap.
 */
export function NotificationFailuresBoard() {
  return (
    <div
      className="flex flex-col gap-4 p-6"
      data-testid="mp.admin.notifications.board"
    >
      <h2 className="font-semibold text-neutral-900">Notification failures</h2>
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-neutral-900"
        data-testid="mp.admin.notifications.unavailable"
      >
        <p className="font-semibold">Data source not available.</p>
        <p className="mt-2 text-xs text-neutral-700">
          notification-service keeps a real dead-letter set (
          <code className="font-mono">notif:mp:dlq</code>) and a pending set (
          <code className="font-mono">notif:mp:pending</code>) for marketplace
          push delivery (
          <code className="font-mono">
            services/notification-service/src/marketplace/consumer.ts
          </code>
          ), but no admin-authenticated endpoint anywhere exposes them — they
          are internal Redis state only.
        </p>
        <p className="mt-2 text-xs text-neutral-700">
          Closing this gap needs a read-only admin route in notification-service
          (e.g.{" "}
          <code className="font-mono">GET /admin/mp/notifications/dlq</code>) —
          outside this change&rsquo;s writable scope (payment/notification
          services are off limits here). This board will start reading real rows
          the moment that route exists; it will never render invented ones in
          the meantime.
        </p>
      </div>
    </div>
  );
}
