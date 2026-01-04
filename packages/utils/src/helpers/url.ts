/**
 * URL Utilities
 *
 * Helpers for URL manipulation, query parameters, and deep linking.
 */

/**
 * Parse query string to object
 */
export function parseQueryString(queryString: string): Record<string, string> {
  const params = new URLSearchParams(queryString);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Build query string from object
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });
  
  const result = searchParams.toString();
  return result ? `?${result}` : "";
}

/**
 * Parse URL and extract components
 */
export function parseUrl(url: string): {
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  params: Record<string, string>;
} {
  const parsed = new URL(url);
  return {
    protocol: parsed.protocol,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    params: parseQueryString(parsed.search),
  };
}

/**
 * Join URL path segments
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((segment, index) => {
      let s = segment;
      // Remove leading slash (except for first segment)
      if (index > 0 && s.startsWith("/")) {
        s = s.slice(1);
      }
      // Remove trailing slash (except for last segment)
      if (index < segments.length - 1 && s.endsWith("/")) {
        s = s.slice(0, -1);
      }
      return s;
    })
    .filter(Boolean)
    .join("/");
}

/**
 * Add or update query parameters to a URL
 */
export function updateQueryParams(
  url: string,
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const parsed = new URL(url, "http://dummy");
  
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      parsed.searchParams.delete(key);
    } else {
      parsed.searchParams.set(key, String(value));
    }
  });
  
  // Return relative URL if input was relative
  if (!url.startsWith("http")) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  
  return parsed.toString();
}

/**
 * Remove query parameters from URL
 */
export function removeQueryParams(url: string, keys: string[]): string {
  const parsed = new URL(url, "http://dummy");
  keys.forEach((key) => parsed.searchParams.delete(key));
  
  if (!url.startsWith("http")) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  
  return parsed.toString();
}

/**
 * Check if URL is absolute
 */
export function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * Check if URL is same origin
 */
export function isSameOrigin(url: string, base?: string): boolean {
  try {
    const parsedUrl = new URL(url, base || window.location.href);
    const baseUrl = new URL(base || window.location.href);
    return parsedUrl.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Generate deep link URL for UBI apps
 */
export type UBIDeepLinkAction =
  | "ride"
  | "ride-estimate"
  | "food-order"
  | "restaurant"
  | "delivery"
  | "wallet"
  | "profile"
  | "referral";

export interface DeepLinkParams {
  action: UBIDeepLinkAction;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Generate UBI deep link
 */
export function generateDeepLink(params: DeepLinkParams): string {
  const { action, ...rest } = params;
  const queryString = buildQueryString(rest);
  return `ubi://${action}${queryString}`;
}

/**
 * Generate universal link for UBI
 */
export function generateUniversalLink(
  params: DeepLinkParams,
  baseUrl = "https://app.ubi.africa"
): string {
  const { action, ...rest } = params;
  const queryString = buildQueryString(rest);
  return `${baseUrl}/${action}${queryString}`;
}

/**
 * Parse UBI deep link
 */
export function parseDeepLink(url: string): DeepLinkParams | null {
  try {
    // Handle ubi:// scheme
    if (url.startsWith("ubi://")) {
      const withoutScheme = url.replace("ubi://", "https://ubi.africa/");
      const parsed = new URL(withoutScheme);
      const action = parsed.pathname.slice(1) as UBIDeepLinkAction;
      const params = parseQueryString(parsed.search);
      return { action, ...params };
    }
    
    // Handle universal links
    if (url.includes("ubi.africa")) {
      const parsed = new URL(url);
      const action = parsed.pathname.slice(1) as UBIDeepLinkAction;
      const params = parseQueryString(parsed.search);
      return { action, ...params };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate share URL with UTM parameters
 */
export interface UTMParams {
  source: string;
  medium: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export function generateShareUrl(baseUrl: string, utm: UTMParams): string {
  const params: Record<string, string | undefined> = {
    utm_source: utm.source,
    utm_medium: utm.medium,
    utm_campaign: utm.campaign,
    utm_term: utm.term,
    utm_content: utm.content,
  };
  
  return updateQueryParams(baseUrl, params);
}

/**
 * Extract UTM parameters from URL
 */
export function extractUTMParams(url: string): Partial<UTMParams> {
  const parsed = parseUrl(url);
  return {
    source: parsed.params.utm_source,
    medium: parsed.params.utm_medium,
    campaign: parsed.params.utm_campaign,
    term: parsed.params.utm_term,
    content: parsed.params.utm_content,
  };
}
