/**
 * Application Hooks
 *
 * Custom React hooks for the UBI web app.
 */

// ===========================================
// Geolocation Hook
// ===========================================

import { useLocationStore } from "@/store";
import type { Coordinates } from "@ubi/utils";
import { supportsGeolocation } from "@ubi/utils";
import { useCallback, useEffect, useState } from "react";

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

interface GeolocationState {
  location: Coordinates | null;
  error: string | null;
  isLoading: boolean;
  isSupported: boolean;
  permission: "granted" | "denied" | "prompt" | "unknown";
}

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const {
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 60000,
  } = options;

  const {
    setCurrentLocation,
    setLocationPermission,
    setLocationLoading,
    setLocationError,
    currentLocation,
    locationPermission,
    isLoadingLocation,
    locationError,
  } = useLocationStore();

  const [isSupported] = useState(() => supportsGeolocation());

  const requestLocation = useCallback(async () => {
    if (!isSupported) {
      setLocationError("Geolocation is not supported by this browser");
      return;
    }

    setLocationLoading(true);
    setLocationError(null);

    try {
      // Check permission status
      if ("permissions" in navigator) {
        const permission = await navigator.permissions.query({ name: "geolocation" });
        setLocationPermission(permission.state as "granted" | "denied" | "prompt");
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy,
          timeout,
          maximumAge,
        });
      });

      const coords: Coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      setCurrentLocation(coords);
      setLocationPermission("granted");
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      let errorMessage = "Unable to get location";

      switch (geoError.code) {
        case geoError.PERMISSION_DENIED:
          errorMessage = "Location permission denied";
          setLocationPermission("denied");
          break;
        case geoError.POSITION_UNAVAILABLE:
          errorMessage = "Location information unavailable";
          break;
        case geoError.TIMEOUT:
          errorMessage = "Location request timed out";
          break;
      }

      setLocationError(errorMessage);
    } finally {
      setLocationLoading(false);
    }
  }, [isSupported, enableHighAccuracy, timeout, maximumAge, setCurrentLocation, setLocationPermission, setLocationLoading, setLocationError]);

  // Watch position for real-time updates
  const watchLocation = useCallback(() => {
    if (!isSupported) return () => {};

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setCurrentLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        console.warn("Watch location error:", error.message);
      },
      { enableHighAccuracy, timeout, maximumAge }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isSupported, enableHighAccuracy, timeout, maximumAge, setCurrentLocation]);

  return {
    location: currentLocation,
    error: locationError,
    isLoading: isLoadingLocation,
    isSupported,
    permission: locationPermission,
    requestLocation,
    watchLocation,
  };
}

// ===========================================
// Debounce Hook
// ===========================================

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ===========================================
// Media Query Hook
// ===========================================

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

// Convenience hooks for common breakpoints
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

export function useIsTablet(): boolean {
  return useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
}

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

// ===========================================
// Online Status Hook
// ===========================================

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

// ===========================================
// Local Storage Hook
// ===========================================

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  return [storedValue, setValue];
}

// ===========================================
// Clipboard Hook
// ===========================================

interface UseClipboardOptions {
  timeout?: number;
}

export function useClipboard(options: UseClipboardOptions = {}) {
  const { timeout = 2000 } = options;
  const [hasCopied, setHasCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), timeout);
        return true;
      } catch {
        setHasCopied(false);
        return false;
      }
    },
    [timeout]
  );

  return { copy, hasCopied };
}

// ===========================================
// Scroll Lock Hook
// ===========================================

export function useScrollLock(lock: boolean) {
  useEffect(() => {
    if (!lock) return;

    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, [lock]);
}

// ===========================================
// Previous Value Hook
// ===========================================

export function usePrevious<T>(value: T): T | undefined {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState<T | undefined>(undefined);

  if (value !== current) {
    setPrevious(current);
    setCurrent(value);
  }

  return previous;
}

// ===========================================
// Interval Hook
// ===========================================

export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useCallback(callback, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const id = setInterval(savedCallback, delay);
    return () => clearInterval(id);
  }, [delay, savedCallback]);
}

// ===========================================
// Document Title Hook
// ===========================================

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
