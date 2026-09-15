import {
  getCityAvailability,
  joinNames,
  liveServices,
  rideFacts,
  SERVICE_LABEL,
} from "@/lib/availability";

import { MarketingAnalytics } from "./MarketingAnalytics";
import { StatusPill } from "./StatusPill";

/**
 * The parts of the hero that depend on flags: the status pill and the lead.
 * Each is rendered behind its own Suspense boundary so the heading and CTAs
 * paint first and no "Live" pill appears before flags resolve (board 24c
 * loading state).
 */
export async function CityHeroPill({ cityId }: { cityId: string }) {
  const availability = await getCityAvailability(cityId);
  if (availability.status !== "ok") return null;
  const live = liveServices(availability.services);
  const labels = live.map((key) => SERVICE_LABEL[key]);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <StatusPill
        status={live.includes("move") ? "live" : "not_yet"}
        label={
          live.length > 0
            ? `Live in ${availability.cityName} · ${labels.join(", ")}`
            : `Nothing live yet in ${availability.cityName}`
        }
      />
      <span className="mk-small" data-testid="marketing.city.checked">
        Availability checked just now · {availability.timezone}
      </span>
      <MarketingAnalytics
        view={{ cityId: availability.cityId, liveServices: live }}
      />
    </div>
  );
}

export function neutralLead(cityName: string): string {
  return `Here is exactly what UBI offers in ${cityName} today.`;
}

export async function CityHeroLead({
  cityId,
  cityName,
}: {
  cityId: string;
  cityName: string;
}) {
  const availability = await getCityAvailability(cityId);
  if (availability.status !== "ok") {
    return (
      <p className="mk-lead mb-5 max-w-[560px] lg:mb-[30px]">
        {neutralLead(cityName)}
      </p>
    );
  }
  const live = liveServices(availability.services);
  if (!live.includes("move")) {
    return (
      <p className="mk-lead mb-5 max-w-[560px] lg:mb-[30px]">
        {neutralLead(cityName)}
      </p>
    );
  }
  const facts = rideFacts(availability.config);
  const labels = live.map((key) => SERVICE_LABEL[key]);
  const lead = `${capitalise(joinNames(labels))} in ${cityName}. PIN-verified pickups, every price shown before you confirm, and ${joinNames(
    facts.payList.map((method) =>
      method === "UBI Wallet" ? method : method.toLowerCase(),
    ),
  )} to pay.`;
  return (
    <p
      className="mk-lead mb-5 max-w-[560px] lg:mb-[30px]"
      data-testid="marketing.city.lead"
    >
      {lead}
    </p>
  );
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}
