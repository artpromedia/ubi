/**
 * Flag guards for callers.
 *
 * A disabled vertical must 404, not 403: a deep link into Bites in a city where
 * Bites is off should look like a page that does not exist, not like a locked
 * door (CLAUDE.md #5). `featureDisabled` carries exactly that status.
 */
import {
  type FlagKey,
  type FlagSet,
  featureDisabled,
  isEnabled,
} from "@ubi/contracts";

export function flagEnabled(flags: FlagSet | undefined, key: FlagKey): boolean {
  return isEnabled(flags, key);
}

/** Throws `feature_disabled` (404) unless the flag is explicitly on. */
export function requireFlag(flags: FlagSet | undefined, key: FlagKey): void {
  if (!isEnabled(flags, key)) {
    throw featureDisabled(key);
  }
}
