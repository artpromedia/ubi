"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics-client";

interface CityView {
  readonly cityId: string;
  readonly liveServices: readonly string[];
}

/**
 * Emits marketing_city_viewed once per render of a city page and
 * marketing_cta_clicked for any anchor carrying data-analytics. Both are
 * consent-gated inside `track`; before consent nothing leaves the page.
 */
export function MarketingAnalytics({ view }: { view?: CityView }) {
  const cityId = view?.cityId;
  const liveServices = view?.liveServices.join(",");

  useEffect(() => {
    if (cityId !== undefined) {
      void track({
        name: "marketing_city_viewed",
        cityId,
        liveServices: liveServices ? liveServices.split(",") : [],
      });
    }
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[data-analytics]");
      if (anchor === null || anchor === undefined) return;
      void track({
        name: "marketing_cta_clicked",
        cta: anchor.dataset["analytics"] ?? "unknown",
        destinationSet: anchor.dataset["destinationSet"] !== "false",
      });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [cityId, liveServices]);

  return null;
}
