/**
 * Storage Utilities
 *
 * Type-safe browser storage helpers with serialization, expiration, and fallbacks.
 */

/**
 * Storage types
 */
export type StorageType = "local" | "session";

/**
 * Storage item with optional expiration
 */
interface StorageItem<T> {
  value: T;
  expiresAt?: number;
}

/**
 * Storage options
 */
export interface StorageOptions {
  /** Time to live in milliseconds */
  ttl?: number;
  /** Storage type (local or session) */
  type?: StorageType;
}

/**
 * Check if we're in a browser environment
 */
function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

/**
 * Get the storage object
 */
function getStorage(type: StorageType): Storage | null {
  if (!isBrowser()) {
    return null;
  }
  return type === "local" ? window.localStorage : window.sessionStorage;
}

/**
 * Set an item in storage with optional TTL
 */
export function setItem<T>(
  key: string,
  value: T,
  options: StorageOptions = {},
): boolean {
  const { ttl, type = "local" } = options;
  const storage = getStorage(type);

  if (!storage) {
    return false;
  }

  try {
    const item: StorageItem<T> = {
      value,
      expiresAt: ttl ? Date.now() + ttl : undefined,
    };
    storage.setItem(key, JSON.stringify(item));
    return true;
  } catch (error) {
    // Handle quota exceeded or other errors
    console.warn(`Failed to set storage item "${key}":`, error);
    return false;
  }
}

/**
 * Get an item from storage
 */
export function getItem<T>(
  key: string,
  options: Pick<StorageOptions, "type"> = {},
): T | null {
  const { type = "local" } = options;
  const storage = getStorage(type);

  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }

    const item: StorageItem<T> = JSON.parse(raw);

    // Check expiration
    if (item.expiresAt && Date.now() > item.expiresAt) {
      storage.removeItem(key);
      return null;
    }

    return item.value;
  } catch (error) {
    console.warn(`Failed to get storage item "${key}":`, error);
    return null;
  }
}

/**
 * Remove an item from storage
 */
export function removeItem(
  key: string,
  options: Pick<StorageOptions, "type"> = {},
): boolean {
  const { type = "local" } = options;
  const storage = getStorage(type);

  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`Failed to remove storage item "${key}":`, error);
    return false;
  }
}

/**
 * Check if an item exists in storage
 */
export function hasItem(
  key: string,
  options: Pick<StorageOptions, "type"> = {},
): boolean {
  return getItem(key, options) !== null;
}

/**
 * Get all keys in storage matching a prefix
 */
export function getKeys(
  prefix?: string,
  options: Pick<StorageOptions, "type"> = {},
): string[] {
  const { type = "local" } = options;
  const storage = getStorage(type);

  if (!storage) {
    return [];
  }

  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (!prefix || key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Clear all items with a specific prefix
 */
export function clearPrefix(
  prefix: string,
  options: Pick<StorageOptions, "type"> = {},
): number {
  const keys = getKeys(prefix, options);
  keys.forEach((key) => removeItem(key, options));
  return keys.length;
}

/**
 * Create a namespaced storage instance
 */
export function createNamespacedStorage(
  namespace: string,
  type: StorageType = "local",
) {
  const prefix = `${namespace}:`;

  return {
    set<T>(key: string, value: T, ttl?: number): boolean {
      return setItem(`${prefix}${key}`, value, { ttl, type });
    },
    get<T>(key: string): T | null {
      return getItem<T>(`${prefix}${key}`, { type });
    },
    remove(key: string): boolean {
      return removeItem(`${prefix}${key}`, { type });
    },
    has(key: string): boolean {
      return hasItem(`${prefix}${key}`, { type });
    },
    keys(): string[] {
      return getKeys(prefix, { type }).map((k) => k.slice(prefix.length));
    },
    clear(): number {
      return clearPrefix(prefix, { type });
    },
  };
}

/**
 * UBI-specific storage namespaces
 */
export const ubiStorage = {
  auth: createNamespacedStorage("ubi:auth"),
  user: createNamespacedStorage("ubi:user"),
  ride: createNamespacedStorage("ubi:ride"),
  food: createNamespacedStorage("ubi:food"),
  delivery: createNamespacedStorage("ubi:delivery"),
  preferences: createNamespacedStorage("ubi:preferences"),
  cache: createNamespacedStorage("ubi:cache"),
};

/**
 * Storage keys constants
 */
export const STORAGE_KEYS = {
  // Auth
  ACCESS_TOKEN: "access_token",
  REFRESH_TOKEN: "refresh_token",
  USER_ID: "user_id",
  DEVICE_ID: "device_id",

  // User preferences
  THEME: "theme",
  LANGUAGE: "language",
  CURRENCY: "currency",
  COUNTRY: "country",

  // App state
  LAST_LOCATION: "last_location",
  SAVED_ADDRESSES: "saved_addresses",
  RECENT_SEARCHES: "recent_searches",
  FAVORITE_RESTAURANTS: "favorite_restaurants",

  // Onboarding
  ONBOARDING_COMPLETE: "onboarding_complete",
  FIRST_RIDE_COMPLETE: "first_ride_complete",
  FIRST_ORDER_COMPLETE: "first_order_complete",
} as const;
