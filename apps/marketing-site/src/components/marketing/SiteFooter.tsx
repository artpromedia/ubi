import Image from "next/image";
import Link from "next/link";

import { cityPath } from "@/lib/availability-pure";

import { DestinationLink } from "./DestinationLink";

interface FooterCity {
  readonly id: string;
  readonly name: string;
}

export function SiteFooter({
  cities,
  plannedCount = 0,
  tagline,
}: {
  cities: readonly FooterCity[];
  plannedCount?: number;
  tagline?: string;
}) {
  return (
    <footer className="border-t border-mk-border">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-6 px-[18px] py-7 text-[13px] text-mk-muted lg:px-[72px]">
        <Link href="/" aria-label="UBI home" className="flex items-center">
          <Image
            src="/brand/ubi-logo-black.svg"
            alt="UBI"
            width={120}
            height={60}
            className="h-6 w-auto opacity-85"
          />
        </Link>
        {tagline ? <span>{tagline}</span> : null}
        <span>
          Cities:{" "}
          {cities.length > 0 ? (
            cities.map((city, index) => (
              <span key={city.id}>
                {index > 0 ? " · " : ""}
                <Link
                  href={cityPath(city)}
                  className="font-semibold text-mk-forest"
                >
                  {city.name}
                </Link>
              </span>
            ))
          ) : (
            <span>listed as they launch</span>
          )}
          {plannedCount > 0 ? (
            <span>
              {cities.length > 0 ? " · " : " "}
              <Link href="/cities" className="font-semibold text-mk-forest">
                Planned cities
              </Link>
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap gap-[18px] lg:ml-auto">
          <DestinationLink to="privacy" variant="text">
            Privacy
          </DestinationLink>
          <DestinationLink to="terms" variant="text">
            Terms
          </DestinationLink>
          <Link
            href="/help"
            className="inline-flex min-h-target items-center font-semibold text-mk-forest underline underline-offset-[3px]"
          >
            Help
          </Link>
        </span>
      </div>
    </footer>
  );
}
