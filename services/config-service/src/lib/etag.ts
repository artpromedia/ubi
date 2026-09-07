/**
 * Strong ETags for activated city configs. The tag is a hash of the exact value
 * a client receives, so a new activation always produces a new tag and a re-read
 * of the same version always produces the same one.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "./json";

export function strongEtag(value: unknown): string {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("base64url");
  return `"${digest}"`;
}

/**
 * RFC 9110 If-None-Match. A weak validator (W/"...") matches too: for a
 * read-only GET, weak comparison is the correct semantics.
 */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined || ifNoneMatch.trim() === "") return false;
  const candidates = ifNoneMatch.split(",").map((part) => part.trim());
  if (candidates.includes("*")) return true;
  return candidates.some((candidate) => candidate === etag || candidate === `W/${etag}`);
}
