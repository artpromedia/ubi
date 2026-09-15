import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { CityCarousel } from "@/components/marketing/CityCarousel";
import { MarketingAnalytics } from "@/components/marketing/MarketingAnalytics";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { StatusPill } from "@/components/marketing/StatusPill";
import {
  type CityRow,
  cityPath,
  getCityAvailability,
  joinNames,
  listCities,
  liveServices,
  rideFacts,
  SERVICE_LABEL,
} from "@/lib/availability";
import { citySlides } from "@/lib/city-images";

export const metadata: Metadata = {
  title: "Where UBI is",
  description:
    "See exactly what is on in each UBI city today, which cities are launching, and where UBI plans to go next.",
  alternates: { canonical: "https://www.ubi.africa/cities" },
};

/** Board 24f. Live now / Launching / Planned next from city rows. No dates, no counts, no sign-ups. */
export default async function CitiesPage() {
  await connection();
  const rows = await listCities();
  const active = rows.filter((c) => c.status === "active");
  const launching = rows.filter((c) => c.status === "launching");
  const planned = rows.filter((c) => c.status === "planned");
  const paused = rows.filter((c) => c.status === "paused");

  const activeCards = await Promise.all(
    active.map(async (city) => {
      const availability = await getCityAvailability(city.id);
      if (availability.status !== "ok") {
        return {
          city,
          pill: "Live",
          body: "What's on today is shown on the city page.",
        };
      }
      const live = liveServices(availability.services);
      const facts = rideFacts(availability.config);
      const labels = live.map((key) => SERVICE_LABEL[key]);
      const body =
        live.length > 0
          ? `${capitalise(joinNames(labels))}.${
              live.includes("move")
                ? ` ${joinNames(facts.payList)}.${
                    facts.airportCodes
                      ? ` Airport pickups at ${facts.airportCodes}.`
                      : ""
                  }`
                : ""
            }`
          : "See what's on today.";
      const pill =
        live.length > 0
          ? `Live · ${live.length} ${live.length === 1 ? "service" : "services"}`
          : "Live";
      return { city, pill, body };
    }),
  );

  const launchNames = (active.length >= 2 ? active : launching).map(
    (c) => c.name,
  );
  const intro =
    active.length >= 2
      ? `UBI launched in ${joinNames(launchNames)} together.`
      : launching.length >= 2
        ? `UBI launches in ${joinNames(launchNames)} together.`
        : launching.length === 1
          ? `UBI launches in ${launchNames[0]} first.`
          : active.length === 1
            ? `UBI is live in ${active[0]!.name}.`
            : "UBI launches city by city.";

  return (
    <div className="min-h-screen bg-mk-canvas text-mk-ink">
      <SiteHeader current="cities" />
      <MarketingAnalytics />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[1440px] px-[18px] py-10 lg:px-[72px] lg:py-16"
      >
        <h1 className="mk-h1 mb-3 lg:!text-[48px]">Where UBI is</h1>
        <p className="mk-lead mb-8 max-w-[640px] lg:mb-10">
          {intro} Each city below shows exactly what&apos;s on today. We
          don&apos;t publish dates, counts or pre-orders.
        </p>
        {active.length > 0 ? (
          <CityCarousel
            slides={citySlides(active, true)}
            activeCityId={active[0]!.id}
            auto
            className="mb-10 h-[260px] lg:h-[420px]"
          />
        ) : null}
        {rows.length === 0 ? (
          <p
            role="status"
            data-testid="marketing.cities.unavailable"
            className="mk-body mb-8 rounded-[12px] border border-mk-warn-border bg-mk-warn-bg px-3.5 py-3"
          >
            We can&apos;t load the city list right now. Open the app to see
            what&apos;s available where you are.
          </p>
        ) : null}
        <div
          data-testid="marketing.cities.launch"
          className="mb-10 grid gap-[18px] lg:grid-cols-2"
        >
          {activeCards.map(({ city, pill, body }) => (
            <CityCard key={city.id} city={city} body={body}>
              <StatusPill status="live" label={pill} />
            </CityCard>
          ))}
          {launching.map((city) => (
            <CityCard
              key={city.id}
              city={city}
              body="A launch city. Rides open the day we switch them on; drivers can apply now."
            >
              <StatusPill status="launching" />
            </CityCard>
          ))}
          {paused.map((city) => (
            <CityCard
              key={city.id}
              city={city}
              body="Paused. Nothing is available right now; the app shows the moment services resume."
            >
              <StatusPill status="not_launched" label="Paused" />
            </CityCard>
          ))}
        </div>
        {planned.length > 0 ? (
          <section
            data-testid="marketing.cities.planned"
            aria-labelledby="planned"
            className="rounded-card-lg border border-dashed border-mk-border-dashed bg-mk-surface p-7 lg:px-8"
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="planned" className="mk-h2 !text-[26px]">
                Planned next
              </h2>
              <span className="mk-small">
                In no particular order · no dates · no sign-ups
              </span>
            </div>
            <p className="mk-body mb-[18px] max-w-[720px]">
              {launchNames.length > 0
                ? `After ${joinNames(launchNames)}, `
                : ""}
              UBI plans to expand to these cities. A city moves up to
              &quot;Launching&quot; here the moment it&apos;s set up. Not
              before.
            </p>
            <ul className="flex flex-wrap gap-2.5">
              {planned.map((city) => (
                <li key={city.id}>
                  <Link
                    href={cityPath(city)}
                    className="inline-flex min-h-target items-center rounded-full border border-mk-border bg-mk-canvas px-4 py-2.5 text-[14.5px] font-semibold text-mk-forest no-underline"
                  >
                    {city.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="mk-small mt-[22px]">
          Driving with UBI? Applications in a launching city open before rides
          do.{" "}
          <Link
            href="/drive"
            className="text-mk-forest underline underline-offset-[3px]"
          >
            See what you need
          </Link>
          .
        </p>
      </main>
      <SiteFooter cities={active} plannedCount={planned.length} />
    </div>
  );
}

function CityCard({
  city,
  body,
  children,
}: {
  city: CityRow;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={cityPath(city)}
      data-testid={`marketing.cities.card.${city.id}`}
      className="block rounded-card-lg border border-mk-border bg-mk-surface p-7 text-inherit no-underline hover:bg-mk-mint/40"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        {children}
        <span className="mk-small">
          {[city.region, city.timezone].filter(Boolean).join(" · ")}
        </span>
      </div>
      <h2 className="mk-h2 mb-2 !text-[30px]">{city.name}</h2>
      <p className="mk-body mb-4">{body}</p>
      <span className="font-semibold text-mk-forest underline underline-offset-[3px]">
        UBI in {city.name} →
      </span>
    </Link>
  );
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}
