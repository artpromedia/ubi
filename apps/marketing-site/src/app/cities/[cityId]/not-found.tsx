import Link from "next/link";

import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { StatusPill } from "@/components/marketing/StatusPill";
import { cityPath, joinNames, listActiveCities } from "@/lib/availability";

/** Board 24c "not a configured city": HTTP 404, no waitlist, points to live cities. */
export default async function CityNotFound() {
  const cities = await listActiveCities();
  return (
    <div className="min-h-screen bg-mk-canvas text-mk-ink">
      <SiteHeader current="cities" />
      <main
        id="main"
        tabIndex={-1}
        data-testid="marketing.city.notFound"
        className="mx-auto max-w-[720px] px-[18px] py-14 lg:px-[72px] lg:py-24"
      >
        <StatusPill status="not_launched" />
        <h1 className="mk-h1 mb-2 mt-3 !text-[38px] lg:!text-[44px]">
          UBI isn&apos;t here yet
        </h1>
        <p className="mk-lead mb-4">
          We don&apos;t take sign-ups or promise a date.
          {cities.length > 0
            ? ` UBI currently operates in ${joinNames(cities.map((c) => c.name))}.`
            : ""}
        </p>
        <div className="flex flex-wrap gap-4">
          {cities.map((city) => (
            <Link
              key={city.id}
              href={cityPath(city)}
              className="inline-flex min-h-target items-center font-semibold text-mk-forest underline underline-offset-[3px]"
            >
              See UBI in {city.name} →
            </Link>
          ))}
          <Link
            href="/cities"
            className="inline-flex min-h-target items-center font-semibold text-mk-forest underline underline-offset-[3px]"
          >
            All cities →
          </Link>
        </div>
      </main>
      <SiteFooter cities={cities} />
    </div>
  );
}
