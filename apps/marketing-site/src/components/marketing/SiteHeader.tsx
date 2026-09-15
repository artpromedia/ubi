import Image from "next/image";
import Link from "next/link";

import { DestinationLink } from "./DestinationLink";
import { MobileMenu } from "./MobileMenu";
import { SkipLink } from "./SkipLink";

export type CurrentPage = "ride" | "drive" | "cities" | "help";

/** Only routes that exist: Ride → /, Drive → /drive, Cities → /cities, Help → /help. */
export const PRIMARY_NAV: readonly {
  href: string;
  label: string;
  key: CurrentPage;
}[] = [
  { href: "/", label: "Ride", key: "ride" },
  { href: "/drive", label: "Drive", key: "drive" },
  { href: "/cities", label: "Cities", key: "cities" },
  { href: "/help", label: "Help", key: "help" },
];

/**
 * Rider path (forest CTAs) or driver path (UBI green CTAs), chosen by the page.
 * Tab order: skip link → logo → nav → CTAs (→ menu button on mobile).
 */
export function SiteHeader({
  current,
  audience = "rider",
}: {
  current: CurrentPage;
  audience?: "rider" | "driver";
}) {
  const links = PRIMARY_NAV.map((link) => ({
    ...link,
    current: link.key === current,
  }));
  const cta =
    audience === "driver" ? (
      <>
        <DestinationLink
          to="driver"
          variant="text"
          analytics="header_driver_login"
        >
          Driver log in
        </DestinationLink>
        <DestinationLink to="driver" variant="green" analytics="header_apply">
          Apply to drive
        </DestinationLink>
      </>
    ) : (
      <>
        <DestinationLink
          to="rider"
          path="/auth/login"
          variant="text"
          analytics="login"
        >
          Log in
        </DestinationLink>
        <DestinationLink to="rider" variant="forest" analytics="header_get_app">
          Get the app
        </DestinationLink>
      </>
    );
  return (
    <header className="border-b border-mk-border bg-mk-canvas">
      <SkipLink />
      <div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-9 px-[18px] lg:h-[76px] lg:px-[72px]">
        <Link href="/" aria-label="UBI home" className="flex items-center">
          <Image
            src="/brand/ubi-logo-black.svg"
            alt="UBI"
            width={120}
            height={60}
            className="h-7 w-auto lg:h-[34px]"
            priority
          />
        </Link>
        <nav
          aria-label="Primary"
          className="hidden gap-7 text-[14.5px] font-medium text-mk-forest lg:flex"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={link.current ? "page" : undefined}
              className={
                link.current ? "border-b-2 border-mk-green pb-0.5" : ""
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2.5 lg:flex">{cta}</div>
        <div className="ml-auto flex items-center gap-2 lg:hidden">
          <span className="[&>a]:min-h-target [&>a]:px-3.5 [&>a]:py-2.5 [&>a]:text-[13.5px] [&>span]:hidden">
            {audience === "driver" ? (
              <DestinationLink
                to="driver"
                variant="green"
                analytics="header_apply"
              >
                Apply
              </DestinationLink>
            ) : (
              <DestinationLink
                to="rider"
                variant="forest"
                analytics="header_get_app"
              >
                Get the app
              </DestinationLink>
            )}
          </span>
          <MobileMenu links={links} cta={cta} />
        </div>
      </div>
    </header>
  );
}
