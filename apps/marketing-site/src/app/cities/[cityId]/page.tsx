import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { AccessCards } from "@/components/marketing/AccessCards";
import { CityCarousel } from "@/components/marketing/CityCarousel";
import { CityDetails } from "@/components/marketing/CityDetails";
import {
  CityHeroLead,
  CityHeroPill,
  neutralLead,
} from "@/components/marketing/CityHeroAvailability";
import { DestinationLink } from "@/components/marketing/DestinationLink";
import { PreLaunch } from "@/components/marketing/PreLaunch";
import { ServicesGrid } from "@/components/marketing/ServicesGrid";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import {
  citySlug,
  getCityAvailability,
  getCityContext,
  joinNames,
  listCities,
  liveServices,
  SERVICE_LABEL,
} from "@/lib/availability";
import { citySlides } from "@/lib/city-images";

type Params = Promise<{ cityId: string }>;

/**
 * Board 24a (1440) / 24b (390) / 24c (states). Rendered at request time. The
 * shell (header, heading, CTAs, carousel, access cards, footer) paints from
 * city rows and config; everything that depends on flags streams behind
 * Suspense, so no service is called live before flags resolve.
 */
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { cityId } = await params;
  const availability = await getCityAvailability(cityId);
  const slug =
    availability.status === "unknown_city" || availability.status === "error"
      ? cityId.toLowerCase()
      : citySlug(availability.cityName);
  // Relative: resolved against metadataBase (gowithubi.com) by Next.
  const canonical = `/cities/${slug}`;
  if (availability.status === "unknown_city") {
    return {
      title: "City not launched",
      robots: { index: false, follow: false },
    };
  }
  if (availability.status === "pre_launch") {
    if (availability.stage === "launching") {
      return {
        title: `UBI is coming to ${availability.cityName}`,
        description: `${availability.cityName} is one of UBI's launch cities. Rides open the day we switch them on; drivers can apply now.`,
        alternates: { canonical },
      };
    }
    return {
      title: `${availability.cityName}. ${availability.stage === "paused" ? "Paused" : "Planned"}`,
      robots: { index: false, follow: false },
    };
  }
  const name =
    availability.status === "ok"
      ? availability.cityName
      : (availability.cityName ?? cityId.toUpperCase());
  const live =
    availability.status === "ok"
      ? liveServices(availability.services).map((key) => SERVICE_LABEL[key])
      : [];
  return {
    title: `UBI in ${name}${live.length > 0 ? `. ${joinNames(live)}` : ""}`,
    description:
      live.length > 0
        ? `UBI in ${name}: ${joinNames(live)}. What is available today, how a ride works, and how to drive with UBI.`
        : `UBI in ${name}.`,
    alternates: { canonical },
  };
}

export default async function CityPage({ params }: { params: Params }) {
  await connection();
  const { cityId } = await params;
  const context = await getCityContext(cityId);
  if (context.status === "unknown_city") notFound();
  if (context.status === "pre_launch") {
    return (
      <PreLaunch
        cityId={cityId}
        cityName={context.cityName}
        stage={context.stage}
        launchGroupNames={context.launchGroupNames}
      />
    );
  }

  const cityName =
    context.status === "ok"
      ? context.cityName
      : (context.cityName ?? cityId.toUpperCase());
  const region = context.status === "ok" ? context.region : null;
  const slug = citySlug(cityName);
  const rows = await listCities();
  const cities = rows.filter((row) => row.status === "active");
  const plannedCount = rows.filter((row) => row.status === "planned").length;
  const slides = citySlides(
    cities.length > 0 ? cities : [{ id: context.cityId, name: cityName }],
  );

  return (
    <div className="min-h-screen bg-mk-canvas text-mk-ink">
      <SiteHeader current="cities" />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[1440px] px-[18px] lg:px-[72px]"
      >
        <section className="grid items-center gap-6 py-7 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:py-[72px]">
          <div>
            <Suspense fallback={null}>
              <CityHeroPill cityId={cityId} />
            </Suspense>
            <h1 className="mk-h1 mb-3 lg:mb-[18px]">UBI in {cityName}</h1>
            <Suspense
              fallback={
                <p className="mk-lead mb-5 max-w-[560px] lg:mb-[30px]">
                  {neutralLead(cityName)}
                </p>
              }
            >
              <CityHeroLead cityId={cityId} cityName={cityName} />
            </Suspense>
            <div className="grid gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
              <DestinationLink
                to="rider"
                testId="marketing.city.riderCta"
                analytics="ride"
              >
                Open UBI in {cityName}
              </DestinationLink>
              <a
                href={`/drive?city=${slug}`}
                data-testid="marketing.city.driverCta"
                data-analytics="drive"
                className="inline-flex min-h-cta items-center justify-center rounded-cta border-[1.5px] border-mk-forest bg-mk-surface px-6 py-4 text-base font-semibold text-mk-forest hover:bg-mk-mint"
              >
                Drive in {cityName}
              </a>
            </div>
            <p className="mk-small mt-4">
              Riding opens the UBI web app, or the UBI app if it&apos;s
              installed. Driving opens the UBI Driver application.
            </p>
          </div>
          <CityCarousel
            slides={slides}
            activeCityId={context.cityId}
            className="h-[260px] lg:h-[520px]"
          />
        </section>

        <section className="pb-12 lg:pb-16" aria-labelledby="avail">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 lg:mb-[22px]">
            <h2 id="avail" className="mk-h2">
              What&apos;s available in {cityName} today
            </h2>
            <span className="mk-small">
              Read live from UBI&apos;s city configuration · updated when a
              service switches on
            </span>
          </div>
          <ServicesGrid cityId={cityId} />
        </section>

        <Suspense fallback={null}>
          <CityDetails cityId={cityId} cityName={cityName} region={region} />
        </Suspense>

        <div className="pb-12 lg:pb-16">
          <AccessCards cityName={cityName} citySlug={slug} />
        </div>
      </main>
      <SiteFooter cities={cities} plannedCount={plannedCount} />
    </div>
  );
}
