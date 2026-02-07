"use client";

import { useNotifications } from "@/lib/hooks";
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  ChevronLeft,
  Gift,
  Info,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

interface NotificationItem {
  id: string;
  type: "promo" | "alert" | "info" | "success";
  title: string;
  message: string;
  date: string;
  read: boolean;
}

const mockNotifications: NotificationItem[] = [
  {
    id: "1",
    type: "promo",
    title: "Weekend Bonus! 🎉",
    message: "Earn extra KES 500 when you complete 15 trips this weekend.",
    date: "2026-01-30T14:00:00",
    read: false,
  },
  {
    id: "2",
    type: "success",
    title: "Payment Received",
    message: "Your weekly payout of KES 28,500 has been sent to your M-Pesa.",
    date: "2026-01-30T09:00:00",
    read: false,
  },
  {
    id: "3",
    type: "alert",
    title: "Document Expiring Soon",
    message: "Your PSV license will expire in 30 days. Please renew it soon.",
    date: "2026-01-29T16:00:00",
    read: false,
  },
  {
    id: "4",
    type: "info",
    title: "New Feature: Scheduled Rides",
    message:
      "You can now receive ride requests scheduled in advance. Check your settings to enable.",
    date: "2026-01-28T12:00:00",
    read: true,
  },
  {
    id: "5",
    type: "promo",
    title: "Refer a Driver",
    message: "Earn KES 2,000 for each driver you refer who completes 50 trips.",
    date: "2026-01-27T10:00:00",
    read: true,
  },
];

export default function NotificationsPage() {
  // Fetch notifications from API
  const {
    notifications: apiNotifications,
    markAsRead: apiMarkAsRead,
    markAllAsRead: apiMarkAllAsRead,
    deleteNotification: apiDeleteNotification,
  } = useNotifications();

  // Local state for optimistic updates when API unavailable
  const [localNotifications, setLocalNotifications] =
    useState(mockNotifications);

  // Use API notifications if available, otherwise use local state
  const notifications: NotificationItem[] = useMemo(() => {
    if (apiNotifications && apiNotifications.length > 0) {
      return apiNotifications.map((n) => ({
        id: n.id,
        type: (n.type as NotificationItem["type"]) || "info",
        title: n.title,
        message: n.message,
        date: n.createdAt,
        read: n.read,
      }));
    }
    return localNotifications;
  }, [apiNotifications, localNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = useCallback(
    (id: string) => {
      // Try API first, then update local state
      apiMarkAsRead(id);
      setLocalNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    },
    [apiMarkAsRead],
  );

  const markAllAsRead = useCallback(() => {
    apiMarkAllAsRead();
    setLocalNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [apiMarkAllAsRead]);

  const deleteNotification = useCallback(
    (id: string) => {
      apiDeleteNotification(id);
      setLocalNotifications((prev) => prev.filter((n) => n.id !== id));
    },
    [apiDeleteNotification],
  );

  const getIcon = (type: NotificationItem["type"]) => {
    switch (type) {
      case "promo":
        return <Gift className="h-5 w-5" />;
      case "alert":
        return <AlertTriangle className="h-5 w-5" />;
      case "success":
        return <CheckCircle className="h-5 w-5" />;
      default:
        return <Info className="h-5 w-5" />;
    }
  };

  const getIconColor = (type: NotificationItem["type"]) => {
    switch (type) {
      case "promo":
        return "bg-purple-100 text-purple-600";
      case "alert":
        return "bg-yellow-100 text-yellow-600";
      case "success":
        return "bg-green-100 text-green-600";
      default:
        return "bg-blue-100 text-blue-600";
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    return date.toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12 safe-area-top">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-white">Notifications</h1>
                {unreadCount > 0 && (
                  <p className="text-sm text-white/70">
                    {unreadCount} unread notification
                    {unreadCount > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm font-medium text-primary"
              >
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Notifications List */}
        <div className="px-4 py-6">
          {notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-4 text-gray-500">No notifications yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => markAsRead(notification.id)}
                  className={`relative rounded-xl p-4 shadow-sm cursor-pointer transition-all text-left w-full ${
                    notification.read
                      ? "bg-white"
                      : "bg-white ring-2 ring-primary/20"
                  }`}
                >
                  {!notification.read && (
                    <div className="absolute top-4 right-4 h-2 w-2 rounded-full bg-primary" />
                  )}
                  <div className="flex gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full ${getIconColor(
                        notification.type,
                      )}`}
                    >
                      {getIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-gray-900">
                          {notification.title}
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notification.id);
                          }}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mt-1 text-sm text-gray-600 line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="mt-2 text-xs text-gray-400">
                        {formatDate(notification.date)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
