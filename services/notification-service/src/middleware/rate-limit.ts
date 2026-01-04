/**
 * Rate Limiting Middleware
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { RateLimiter } from '../lib/redis';

// ============================================
// Default Rate Limiters
// ============================================

// General API rate limiter
export const apiRateLimiter = new RateLimiter({
  keyPrefix: 'ratelimit:api',
  limit: 100,
  windowSeconds: 60,
});

// SMS rate limiter (more restrictive)
export const smsRateLimiter = new RateLimiter({
  keyPrefix: 'ratelimit:sms',
  limit: 10,
  windowSeconds: 60,
});

// OTP rate limiter (very restrictive)
export const otpRateLimiter = new RateLimiter({
  keyPrefix: 'ratelimit:otp',
  limit: 3,
  windowSeconds: 600, // 10 minutes
});

// Email rate limiter
export const emailRateLimiter = new RateLimiter({
  keyPrefix: 'ratelimit:email',
  limit: 20,
  windowSeconds: 60,
});

// Push notification rate limiter
export const pushRateLimiter = new RateLimiter({
  keyPrefix: 'ratelimit:push',
  limit: 50,
  windowSeconds: 60,
});

// ============================================
// Middleware Factory
// ============================================

export interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
  keyGenerator?: (c: Context) => string;
  message?: string;
  skipFailedRequests?: boolean;
}

/**
 * Create rate limit middleware
 */
export function rateLimit(options: RateLimitOptions) {
  const limiter = new RateLimiter({
    keyPrefix: options.keyPrefix,
    limit: options.limit,
    windowSeconds: options.windowSeconds,
  });

  return async (c: Context, next: Next): Promise<void> => {
    // Generate key (default to IP or user ID)
    const key = options.keyGenerator
      ? options.keyGenerator(c)
      : c.get('userId') || c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP') || 'unknown';

    const result = await limiter.isAllowed(key);

    // Set rate limit headers
    c.res.headers.set('X-RateLimit-Limit', options.limit.toString());
    c.res.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    c.res.headers.set('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

    if (!result.allowed) {
      c.res.headers.set('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000).toString());

      throw new HTTPException(429, {
        message: options.message || 'Too many requests, please try again later',
      });
    }

    await next();
  };
}

/**
 * Create per-endpoint rate limiter
 */
export function createRateLimiter(
  endpoint: string,
  limit: number,
  windowSeconds: number
) {
  return rateLimit({
    keyPrefix: `ratelimit:${endpoint}`,
    limit,
    windowSeconds,
  });
}

// ============================================
// Pre-configured Rate Limiters
// ============================================

/**
 * Strict rate limiter for sensitive operations
 */
export const strictRateLimit = rateLimit({
  keyPrefix: 'ratelimit:strict',
  limit: 5,
  windowSeconds: 300, // 5 minutes
  message: 'Too many attempts. Please wait 5 minutes before trying again.',
});

/**
 * Burst rate limiter (allows bursts but limits over time)
 */
export const burstRateLimit = rateLimit({
  keyPrefix: 'ratelimit:burst',
  limit: 30,
  windowSeconds: 10,
});

/**
 * Daily rate limiter
 */
export const dailyRateLimit = rateLimit({
  keyPrefix: 'ratelimit:daily',
  limit: 1000,
  windowSeconds: 86400, // 24 hours
});

// ============================================
// IP-based Rate Limiting
// ============================================

/**
 * Get client IP from various headers
 */
export function getClientIP(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') || // Cloudflare
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

/**
 * IP-based rate limiter
 */
export function ipRateLimit(limit: number, windowSeconds: number) {
  return rateLimit({
    keyPrefix: 'ratelimit:ip',
    limit,
    windowSeconds,
    keyGenerator: getClientIP,
  });
}
