import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format currency in Nigerian Naira
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format number with K, M suffixes
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num.toString();
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString("en-NG", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Format date for display
 */
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format time for display
 */
export function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Get delivery status class
 */
export function getDeliveryStatusClass(status: string): string {
  const statusMap: Record<string, string> = {
    pending: "pending",
    assigned: "assigned",
    "picked-up": "picked-up",
    "in-transit": "in-transit",
    delivered: "delivered",
    cancelled: "cancelled",
    returned: "returned",
  };
  return statusMap[status.toLowerCase()] || "pending";
}

/**
 * Get priority class
 */
export function getPriorityClass(priority: string): string {
  const priorityMap: Record<string, string> = {
    express: "express",
    "same-day": "same-day",
    standard: "standard",
  };
  return priorityMap[priority.toLowerCase()] || "standard";
}

/**
 * Calculate percentage change
 */
export function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Format tracking number
 */
export function formatTrackingNumber(trackingNumber: string): string {
  // Format as UBI-XXXX-XXXX-XXXX
  return trackingNumber.toUpperCase();
}

/**
 * Format weight in kg
 */
export function formatWeight(weight: number): string {
  if (weight < 1) {
    return `${(weight * 1000).toFixed(0)}g`;
  }
  return `${weight.toFixed(1)}kg`;
}

/**
 * Format distance in km
 */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${(km * 1000).toFixed(0)}m`;
  }
  return `${km.toFixed(1)}km`;
}

/**
 * Get estimated delivery time
 */
export function getEstimatedDelivery(priority: string): string {
  switch (priority.toLowerCase()) {
    case "express":
      return "2-4 hours";
    case "same-day":
      return "Today";
    case "standard":
    default:
      return "1-3 days";
  }
}

/**
 * Get initials from name
 */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Truncate text
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}
