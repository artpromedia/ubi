import Link from "next/link";

import { cityPath, joinNames, listActiveCities } from "@/lib/availability";

import { DestinationLink } from "./DestinationLink";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StatusPill } from "./StatusPill";

/**
 * Board 24c launching / planned (and paused). Launching: "coming", driver CTA
 * (onboarding opens before rider launch). Planned: intent only, no CTAs,
 * noindex. Paused: nothing is live; the app says when it resumes. Never a date.
 */
export async function PreLaunch({
  cityName,
  stage,
  launchGroupNames,
}: {
  cityId: string;
  cityName: string;
  stage: "launching" | "planned" | "paused";
  launchGroupNames: readonly string[];
}) {
  const cities = await listActiveCities();
  const launchSet = joinNames(launchGroupNames);
  const operating =
    cities.length > 0
      ? ` UBI operates in ${joinNames(cities.map((c) => c.name))}.`
      : "";
  const heading =
    stage === "launching"
      ? `UBI is coming to ${cityName}`
      : stage === "paused"
        ? `UBI is paused in ${cityName}`
        : `${cityName} is on our list`;
  const body =
    stage === "launching"
      ? `${cityName} is one of UBI's launch cities.${
          launchGroupNames.length > 1 ? ` ${launchSet} open together.` : ""
        } Rides open the day we switch them on; this page and the app will show it. We don't publish a date or take pre-orders.${operating}`
      : stage === "paused"
        ? `Nothing is available in ${cityName} right now. The app shows the moment services resume; we don't publish a date.${operating}`
        : `UBI plans to expand here${
            cities.length > 0
              ? ` after ${joinNames(cities.map((c) => c.name))}`
              : ""
          }. Nothing is available yet and we don't take sign-ups.${operating}`;
  return (
    <div className="min-h-screen bg-mk-canvas text-mk-ink">
      <SiteHeader current="cities" />
      <main
        id="main"
        tabIndex={-1}
        data-testid={`marketing.city.${stage}`}
        className="mx-auto max-w-[720px] px-[18px] py-14 lg:px-[72px] lg:py-24"
      >
        {stage === "launching" ? (
          <StatusPill status="launching" />
        ) : (
          <StatusPill
            status="not_launched"
            label={stage === "paused" ? "Paused" : "Planned · no date"}
          />
        )}
        <h1 className="mk-h1 mb-2 mt-3 !text-[38px] lg:!text-[44px]">
          {heading}
        </h1>
        <p className="mk-lead mb-5">{body}</p>
        {stage === "launching" ? (
          <div className="grid gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
            <DestinationLink
              to="driver"
              variant="green"
              analytics="prelaunch_drive"
            >
              Drive with UBI in {cityName}
            </DestinationLink>
            {cities.map((city) => (
              <Link
                key={city.id}
                href={cityPath(city)}
                className="inline-flex min-h-cta items-center justify-center rounded-cta border-[1.5px] border-mk-forest bg-mk-surface px-6 py-4 text-base font-semibold text-mk-forest"
              >
                See UBI in {city.name}
              </Link>
            ))}
          </div>
        ) : (
          <Link
            href="/cities"
            className="inline-flex min-h-target items-center font-semibold text-mk-forest underline underline-offset-[3px]"
          >
            See all cities →
          </Link>
        )}
      </main>
      <SiteFooter cities={cities} />
    </div>
  );
}
