import Link from "next/link";

import { DestinationLink } from "./DestinationLink";

/** Separate rider and driver conversion paths (board 24a bottom). */
export function AccessCards({
  cityName,
  citySlug,
}: {
  cityName: string;
  citySlug: string;
}) {
  return (
    <section
      aria-label="Get started"
      className="grid gap-[18px] lg:grid-cols-2"
    >
      <div
        data-testid="marketing.access.rider"
        className="rounded-card-lg border border-mk-border bg-mk-surface p-8"
      >
        <div className="mk-label mb-2 text-mk-muted">For riders</div>
        <h2 className="mk-h2 mb-2.5 !text-[26px]">Ride in {cityName}</h2>
        <p className="mk-body mb-[18px]">
          Sign in on the web or get the app. Your account works in both.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <DestinationLink to="rider" analytics="access_rider_web">
            Open UBI on the web
          </DestinationLink>
          <DestinationLink
            to="iosStore"
            variant="outline"
            analytics="store_ios"
          >
            App Store
          </DestinationLink>
          <DestinationLink
            to="androidStore"
            variant="outline"
            analytics="store_android"
          >
            Google Play
          </DestinationLink>
        </div>
      </div>
      <div
        data-testid="marketing.access.driver"
        className="rounded-card-lg border border-mk-mint-border bg-mk-mint p-8"
      >
        <div className="mk-label mb-2 text-mk-forest">For drivers</div>
        <h2 className="mk-h2 mb-2.5 !text-[26px]">
          Drive with UBI in {cityName}
        </h2>
        <p className="mk-body mb-[18px]">
          Bring your licence, identity and vehicle papers. Verification happens
          in the UBI Driver app; you see each document&apos;s status as
          it&apos;s reviewed.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <Link
            href={`/drive?city=${citySlug}`}
            data-analytics="access_driver_requirements"
            className="inline-flex min-h-cta items-center justify-center rounded-cta bg-mk-green px-6 py-4 text-base font-semibold text-mk-green-ink hover:bg-mk-green-hover"
          >
            See what you need
          </Link>
          <DestinationLink
            to="driver"
            variant="outline"
            analytics="access_driver_open"
          >
            Already applied? Open the app
          </DestinationLink>
        </div>
      </div>
    </section>
  );
}
