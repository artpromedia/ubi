/**
 * The marketing site's own origin: gowithubi.com. Used for metadataBase (so
 * every canonical and Open Graph URL resolves against it) and the JSON-LD
 * Organization. Overridable per environment with UBI_SITE_URL (https only).
 */
const DEFAULT_SITE_URL = "https://gowithubi.com";

function siteUrl(): URL {
  const raw = process.env.UBI_SITE_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:") return url;
    } catch {
      // fall through to the default
    }
  }
  return new URL(DEFAULT_SITE_URL);
}

export const SITE_URL: URL = siteUrl();
export const SITE_ORIGIN = SITE_URL.origin;
