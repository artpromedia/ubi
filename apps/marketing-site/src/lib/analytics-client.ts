/**
 * Browser-side marketing analytics, consent-gated.
 *
 * Nothing is tracked until the visitor has granted analytics consent, which
 * the apps record in the `ubi_consent` cookie (either the token `analytics`
 * or JSON with `"analytics": true`). Events go through @ubi/analytics, the
 * repo's existing client, loaded only after consent; with no provider
 * configured they are dropped. No personal data is ever put in a URL.
 */

export const CONSENT_COOKIE = "ubi_consent";

export type MarketingEvent =
  | {
      readonly name: "marketing_city_viewed";
      readonly cityId: string;
      readonly liveServices: readonly string[];
    }
  | {
      readonly name: "marketing_cta_clicked";
      readonly cta: string;
      readonly destinationSet: boolean;
    };

function readCookie(name: string, cookies: string): string | undefined {
  const prefix = `${name}=`;
  const found = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return found === undefined
    ? undefined
    : decodeURIComponent(found.slice(prefix.length));
}

export function hasAnalyticsConsent(
  cookies: string = typeof document === "undefined" ? "" : document.cookie,
): boolean {
  const raw = readCookie(CONSENT_COOKIE, cookies);
  if (raw === undefined || raw === "") return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return (parsed as { analytics?: unknown }).analytics === true;
    }
  } catch {
    // Not JSON: a comma-separated token list.
  }
  return raw
    .split(",")
    .map((token) => token.trim())
    .includes("analytics");
}

type Tracker = {
  track(name: string, properties?: Record<string, unknown>): Promise<void>;
};

let tracker: Promise<Tracker> | undefined;

async function loadTracker(): Promise<Tracker> {
  const { createAnalytics } = await import("@ubi/analytics");
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return createAnalytics({
    providers: apiKey
      ? [{ type: "posthog", apiKey, ...(host ? { host } : {}) }]
      : [],
    defaultProperties: { surface: "marketing-site" },
  });
}

export async function track(event: MarketingEvent): Promise<void> {
  if (!hasAnalyticsConsent()) return;
  tracker ??= loadTracker();
  const { name, ...properties } = event;
  await (await tracker).track(name, properties);
}
