import type { ReactNode } from "react";

import {
  destination,
  PENDING_COPY,
  type DestinationKey,
} from "@/lib/destinations";

export type DestinationVariant = "forest" | "green" | "outline" | "text";

export const CTA_CLASS: Record<DestinationVariant, string> = {
  forest:
    "inline-flex min-h-cta items-center justify-center rounded-cta bg-mk-forest px-6 py-4 text-base font-semibold text-mk-on-forest hover:bg-mk-forest-hover",
  green:
    "inline-flex min-h-cta items-center justify-center rounded-cta bg-mk-green px-6 py-4 text-base font-semibold text-mk-green-ink hover:bg-mk-green-hover",
  outline:
    "inline-flex min-h-cta items-center justify-center rounded-cta border-[1.5px] border-mk-forest bg-mk-surface px-6 py-4 text-base font-semibold text-mk-forest hover:bg-mk-mint",
  text: "inline-flex min-h-target items-center font-semibold text-mk-forest underline underline-offset-[3px]",
};

interface DestinationLinkProps {
  readonly to: DestinationKey;
  readonly path?: string;
  readonly variant?: DestinationVariant;
  readonly children: ReactNode;
  readonly testId?: string;
  /** marketing_cta_clicked{cta} name. Omit for links that are not conversion CTAs. */
  readonly analytics?: string;
}

/**
 * Board 24c "destination not configured". Renders an <a> only for an https
 * destination from the named environment variable; otherwise a
 * non-interactive launch-status notice (not a button, not focusable). Every
 * outbound link on the site goes through here.
 */
export function DestinationLink({
  to,
  path,
  variant = "forest",
  children,
  testId,
  analytics,
}: DestinationLinkProps) {
  const href = destination(to, path);
  if (href === undefined) {
    return (
      <span
        aria-disabled="true"
        data-testid="marketing.destination.pending"
        data-destination={to}
        className="inline-flex items-center justify-center rounded-cta border-[1.5px] border-dashed border-mk-border-dashed px-4 py-3 text-center text-[13.5px] font-medium leading-snug text-mk-muted"
      >
        {PENDING_COPY[to]}
      </span>
    );
  }
  return (
    <a
      href={href}
      rel="noopener"
      data-testid={testId}
      data-analytics={analytics}
      data-destination-set="true"
      className={CTA_CLASS[variant]}
    >
      {children}
    </a>
  );
}
