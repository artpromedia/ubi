/**
 * Mock utilities and implementations
 *
 * Provides common mock implementations for testing UBI services.
 */

// Re-export MSW utilities for convenience
export { startMswWorker } from "../msw/browser";
export { handlers } from "../msw/handlers";
export { setupMswServer } from "../msw/server";

// Common mock implementations

/**
 * Creates a mock Redis client for testing
 */
export function createMockRedis() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();
  const subscribers = new Map<
    string,
    ((channel: string, message: string) => void)[]
  >();

  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    setex: async (key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted++;
      }
      return deleted;
    },
    expire: async (_key: string, _seconds: number) => 1,
    sadd: async (key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      const set = sets.get(key)!;
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added++;
        }
      }
      return added;
    },
    srem: async (key: string, ...members: string[]) => {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const member of members) {
        if (set.delete(member)) removed++;
      }
      return removed;
    },
    smembers: async (key: string) => {
      const set = sets.get(key);
      return set ? Array.from(set) : [];
    },
    hset: async (
      key: string,
      field: string | Record<string, string>,
      value?: string
    ) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const hash = hashes.get(key)!;
      if (typeof field === "object") {
        for (const [k, v] of Object.entries(field)) {
          hash.set(k, String(v));
        }
        return Object.keys(field).length;
      }
      hash.set(field, value!);
      return 1;
    },
    hget: async (key: string, field: string) => {
      const hash = hashes.get(key);
      return hash?.get(field) ?? null;
    },
    hgetall: async (key: string) => {
      const hash = hashes.get(key);
      if (!hash) return {};
      return Object.fromEntries(hash);
    },
    publish: async (_channel: string, _message: string) => 0,
    subscribe: async (
      channel: string,
      callback?: (channel: string, message: string) => void
    ) => {
      if (callback) {
        if (!subscribers.has(channel)) subscribers.set(channel, []);
        subscribers.get(channel)!.push(callback);
      }
    },
    psubscribe: async (_pattern: string) => {},
    on: (_event: string, _callback: (...args: unknown[]) => void) => {},
    pubsub: async (
      _subcommand: string,
      ..._args: string[]
    ): Promise<(string | number)[]> => {
      return ["", 0];
    },
    quit: async () => "OK",
    // Test helpers
    _store: store,
    _sets: sets,
    _hashes: hashes,
    _clear: () => {
      store.clear();
      sets.clear();
      hashes.clear();
    },
  };
}

/**
 * Creates a mock WebSocket for testing
 */
export function createMockWebSocket() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  let readyState = 1; // OPEN

  return {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    get readyState() {
      return readyState;
    },
    send: vi.fn(),
    close: vi.fn((code?: number, _reason?: string) => {
      readyState = 3;
      const closeListeners = listeners.get("close") ?? [];
      for (const listener of closeListeners) {
        listener(code);
      }
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: (event: string, callback: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(callback);
    },
    // Test helpers
    _simulateMessage: (data: unknown) => {
      const messageListeners = listeners.get("message") ?? [];
      for (const listener of messageListeners) {
        listener(Buffer.from(JSON.stringify(data)));
      }
    },
    _simulateError: (error: Error) => {
      const errorListeners = listeners.get("error") ?? [];
      for (const listener of errorListeners) {
        listener(error);
      }
    },
    _simulateClose: () => {
      readyState = 3;
      const closeListeners = listeners.get("close") ?? [];
      for (const listener of closeListeners) {
        listener();
      }
    },
  };
}

// Import vi for mock functions (optional, only available when vitest is installed)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vi: any;
try {
  vi = await import("vitest").then((m) => m.vi);
} catch {
  vi = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: (impl?: any) => impl ?? (() => {}),
  };
}

/**
 * Creates a mock logger for testing
 */
export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

/**
 * Creates a mock event emitter for testing
 */
export function createMockEventEmitter() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners = new Map<string, ((...args: any[]) => void)[]>();

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: (event: string, callback: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(callback);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off: (event: string, callback: (...args: any[]) => void) => {
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        const index = eventListeners.indexOf(callback);
        if (index > -1) eventListeners.splice(index, 1);
      }
    },
    emit: (event: string, ...args: unknown[]) => {
      const eventListeners = listeners.get(event) ?? [];
      for (const listener of eventListeners) {
        listener(...args);
      }
    },
    removeAllListeners: (event?: string) => {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
    },
  };
}
