"use client";
import { NotificationFailuresBoard } from "@/components/marketplace/NotificationFailuresBoard";

/** C08 — notification-failure board (honestly gated; see the component). */
export default function NotificationFailuresContainer() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Notification failures
        </h1>
      </div>
      <div className="flex-1 overflow-auto">
        <NotificationFailuresBoard />
      </div>
    </div>
  );
}
