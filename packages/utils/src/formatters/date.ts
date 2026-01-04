/**
 * Date formatting utilities for UBI
 */

/**
 * Format a date for display
 */
export function formatDate(
  date: Date | string | number,
  locale = "en-US"
): string {
  const d = new Date(date);
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format a date with time
 */
export function formatDateTime(
  date: Date | string | number,
  locale = "en-US"
): string {
  const d = new Date(date);
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format time only
 */
export function formatTime(
  date: Date | string | number,
  locale = "en-US"
): string {
  const d = new Date(date);
  return d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return "just now";
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  return formatDate(d);
}

/**
 * Format estimated arrival time
 */
export function formatETA(minutes: number): string {
  if (minutes < 1) {
    return "Arriving now";
  } else if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
