/**
 * Distance formatting utilities for UBI
 */

/**
 * Format distance in kilometers or meters
 */
export function formatDistance(meters: number, locale = "en-US"): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return (
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(km) + " km"
  );
}

/**
 * Format distance in miles (for markets that use imperial)
 */
export function formatDistanceMiles(meters: number, locale = "en-US"): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) {
    const feet = Math.round(meters * 3.28084);
    return `${feet} ft`;
  }
  return (
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(miles) + " mi"
  );
}

/**
 * Format duration in minutes or hours
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)} sec`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Calculate speed from distance and time
 */
export function calculateSpeed(meters: number, seconds: number): number {
  if (seconds === 0) {return 0;}
  return meters / 1000 / (seconds / 3600); // km/h
}

/**
 * Format speed
 */
export function formatSpeed(kmh: number, locale = "en-US"): string {
  return (
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(kmh) + " km/h"
  );
}
