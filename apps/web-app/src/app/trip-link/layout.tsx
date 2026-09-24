import type { Metadata } from "next";

/**
 * The passenger trip link lives OUTSIDE the (app) group on purpose: no auth store, no
 * analytics providers (which record page URLs), no app chrome. It is never indexed and never
 * sends a Referer onward.
 */
export const metadata: Metadata = {
  title: "Your ride",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function TripLinkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
