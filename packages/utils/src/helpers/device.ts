/**
 * Device & Browser Utilities
 *
 * Helpers for detecting device capabilities, browser features, and environment.
 */

/**
 * Check if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Check if running on server (SSR)
 */
export function isServer(): boolean {
  return !isBrowser();
}

/**
 * Get device type from user agent
 */
export type DeviceType = "mobile" | "tablet" | "desktop";

export function getDeviceType(): DeviceType {
  if (!isBrowser()) {
    return "desktop";
  }

  const ua = navigator.userAgent.toLowerCase();
  const isMobile =
    /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua);
  const isTablet = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua);

  if (isTablet) {
    return "tablet";
  }
  if (isMobile) {
    return "mobile";
  }
  return "desktop";
}

/**
 * Check if device is mobile
 */
export function isMobile(): boolean {
  return getDeviceType() === "mobile";
}

/**
 * Check if device is tablet
 */
export function isTablet(): boolean {
  return getDeviceType() === "tablet";
}

/**
 * Check if device is desktop
 */
export function isDesktop(): boolean {
  return getDeviceType() === "desktop";
}

/**
 * Check if device has touch support
 */
export function hasTouch(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Operating system detection
 */
export type OperatingSystem =
  | "ios"
  | "android"
  | "windows"
  | "macos"
  | "linux"
  | "unknown";

export function getOperatingSystem(): OperatingSystem {
  if (!isBrowser()) {
    return "unknown";
  }

  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() || "";

  if (/iphone|ipad|ipod/.test(ua) || (/mac/.test(platform) && hasTouch())) {
    return "ios";
  }
  if (/android/.test(ua)) {
    return "android";
  }
  if (/win/.test(platform)) {
    return "windows";
  }
  if (/mac/.test(platform)) {
    return "macos";
  }
  if (/linux/.test(platform)) {
    return "linux";
  }

  return "unknown";
}

/**
 * Check if iOS device
 */
export function isIOS(): boolean {
  return getOperatingSystem() === "ios";
}

/**
 * Check if Android device
 */
export function isAndroid(): boolean {
  return getOperatingSystem() === "android";
}

/**
 * Browser detection
 */
export type Browser =
  | "chrome"
  | "firefox"
  | "safari"
  | "edge"
  | "opera"
  | "samsung"
  | "unknown";

export function getBrowser(): Browser {
  if (!isBrowser()) {
    return "unknown";
  }

  const ua = navigator.userAgent.toLowerCase();

  if (/samsungbrowser/.test(ua)) {
    return "samsung";
  }
  if (/edg/.test(ua)) {
    return "edge";
  }
  if (/opr|opera/.test(ua)) {
    return "opera";
  }
  if (/chrome/.test(ua)) {
    return "chrome";
  }
  if (/firefox/.test(ua)) {
    return "firefox";
  }
  if (/safari/.test(ua)) {
    return "safari";
  }

  return "unknown";
}

/**
 * Check if running as PWA (installed)
 */
export function isPWA(): boolean {
  if (!isBrowser()) {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true ||
    document.referrer.includes("android-app://")
  );
}

/**
 * Check if service workers are supported
 */
export function supportsServiceWorker(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return "serviceWorker" in navigator;
}

/**
 * Check if push notifications are supported
 */
export function supportsPushNotifications(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return "PushManager" in window && "Notification" in window;
}

/**
 * Check if geolocation is supported
 */
export function supportsGeolocation(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return "geolocation" in navigator;
}

/**
 * Check if web share API is supported
 */
export function supportsWebShare(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return "share" in navigator;
}

/**
 * Check if clipboard API is supported
 */
export function supportsClipboard(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return "clipboard" in navigator;
}

/**
 * Check if vibration API is supported
 */
export function supportsVibration(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return "vibrate" in navigator;
}

/**
 * Get network connection information
 */
export interface NetworkInfo {
  online: boolean;
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

export function getNetworkInfo(): NetworkInfo {
  if (!isBrowser()) {
    return { online: true };
  }

  const connection = (
    navigator as Navigator & {
      connection?: {
        effectiveType: "slow-2g" | "2g" | "3g" | "4g";
        downlink: number;
        rtt: number;
        saveData: boolean;
      };
    }
  ).connection;

  return {
    online: navigator.onLine,
    effectiveType: connection?.effectiveType,
    downlink: connection?.downlink,
    rtt: connection?.rtt,
    saveData: connection?.saveData,
  };
}

/**
 * Check if device is online
 */
export function isOnline(): boolean {
  if (!isBrowser()) {
    return true;
  }
  return navigator.onLine;
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Check if user prefers dark mode
 */
export function prefersDarkMode(): boolean {
  if (!isBrowser()) {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Get viewport dimensions
 */
export function getViewport(): { width: number; height: number } {
  if (!isBrowser()) {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth || document.documentElement.clientWidth,
    height: window.innerHeight || document.documentElement.clientHeight,
  };
}

/**
 * Check if element is in viewport
 */
export function isInViewport(element: Element, threshold = 0): boolean {
  if (!isBrowser()) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const viewport = getViewport();

  return (
    rect.top >= -threshold &&
    rect.left >= -threshold &&
    rect.bottom <= viewport.height + threshold &&
    rect.right <= viewport.width + threshold
  );
}

/**
 * Device info summary for analytics
 */
export function getDeviceInfo() {
  return {
    deviceType: getDeviceType(),
    os: getOperatingSystem(),
    browser: getBrowser(),
    isPWA: isPWA(),
    hasTouch: hasTouch(),
    viewport: getViewport(),
    network: getNetworkInfo(),
    prefersReducedMotion: prefersReducedMotion(),
    prefersDarkMode: prefersDarkMode(),
    language: isBrowser() ? navigator.language : "en",
    timezone: isBrowser()
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC",
  };
}
