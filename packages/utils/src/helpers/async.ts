/**
 * Async Utilities
 *
 * Helpers for async operations including retries, timeouts, and concurrency control.
 */

/**
 * Sleep for a given duration
 * @param ms - Milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Whether to add jitter to delays */
  jitter: boolean;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback on each retry */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

/**
 * Default retry options
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay =
    options.initialDelay * Math.pow(options.backoffMultiplier, attempt - 1);
  const boundedDelay = Math.min(exponentialDelay, options.maxDelay);

  if (options.jitter) {
    // Add random jitter between 0-25% of delay
    const jitterAmount = boundedDelay * 0.25 * Math.random();
    return Math.floor(boundedDelay + jitterAmount);
  }

  return boundedDelay;
}

/**
 * Retry an async function with exponential backoff
 * @param fn - Function to retry
 * @param options - Retry options
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt > opts.maxRetries) {
        break;
      }

      // Check if error is retryable
      if (opts.isRetryable && !opts.isRetryable(error)) {
        break;
      }

      const delay = calculateDelay(attempt, opts);

      // Call retry callback if provided
      if (opts.onRetry) {
        opts.onRetry(error, attempt, delay);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Timeout an async operation
 * @param promise - Promise to timeout
 * @param ms - Timeout in milliseconds
 * @param message - Error message on timeout
 */
export async function timeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string = "Operation timed out",
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Execute promises with concurrency limit
 * @param items - Items to process
 * @param fn - Async function to run on each item
 * @param concurrency - Maximum concurrent operations
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 5,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) {
      continue;
    }

    const promise = fn(item, i).then((result) => {
      results[i] = result;
    });

    const executingPromise = promise.finally(() => {
      executing.splice(executing.indexOf(executingPromise), 1);
    });

    executing.push(executingPromise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Debounce an async function
 * @param fn - Function to debounce
 * @param ms - Debounce delay in milliseconds
 */
export function debounce<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let pendingPromise: Promise<ReturnType<T>> | undefined;
  let resolveFunction: ((value: ReturnType<T>) => void) | undefined;
  let rejectFunction: ((reason?: unknown) => void) | undefined;

  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    pendingPromise ??= new Promise((resolve, reject) => {
      resolveFunction = resolve;
      rejectFunction = reject;
    });

    timeoutId = setTimeout(async () => {
      try {
        const result = await fn(...args);
        resolveFunction?.(result as ReturnType<T>);
      } catch (error) {
        rejectFunction?.(error);
      } finally {
        pendingPromise = undefined;
        resolveFunction = undefined;
        rejectFunction = undefined;
      }
    }, ms);

    return pendingPromise;
  };
}

/**
 * Throttle an async function
 * @param fn - Function to throttle
 * @param ms - Minimum interval between calls
 */
export function throttle<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => Promise<ReturnType<T> | undefined> {
  let lastCallTime = 0;
  let pendingPromise: Promise<ReturnType<T>> | undefined;

  return async (...args: Parameters<T>): Promise<ReturnType<T> | undefined> => {
    const now = Date.now();

    if (now - lastCallTime < ms) {
      return pendingPromise;
    }

    lastCallTime = now;
    pendingPromise = fn(...args) as Promise<ReturnType<T>>;
    return pendingPromise;
  };
}

/**
 * Create a deferred promise
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Execute an async function with a mutex lock
 */
export class AsyncMutex {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Circuit breaker states
 */
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms to wait before trying again */
  resetTimeout: number;
  /** Number of successes in half-open state to close circuit */
  successThreshold: number;
}

/**
 * Circuit breaker pattern implementation
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      failureThreshold: 5,
      resetTimeout: 30000,
      successThreshold: 2,
      ...options,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeout) {
        this.state = "HALF_OPEN";
        this.successes = 0;
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.state = "CLOSED";
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (
      this.state === "HALF_OPEN" ||
      this.failures >= this.options.failureThreshold
    ) {
      this.state = "OPEN";
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.successes = 0;
  }
}

/**
 * Run multiple promises and return results even if some fail
 */
export function settleAll<T>(
  promises: Promise<T>[],
): Promise<
  Array<
    { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown }
  >
> {
  return Promise.allSettled(promises);
}

/**
 * Run function at most once
 */
export function once<T extends (...args: unknown[]) => unknown>(fn: T): T {
  let called = false;
  let result: ReturnType<T>;

  return ((...args: Parameters<T>) => {
    if (!called) {
      called = true;
      result = fn(...args) as ReturnType<T>;
    }
    return result;
  }) as T;
}
