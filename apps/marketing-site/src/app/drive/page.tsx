import type { Metadata } from "next";
import { connection } from "next/server";

import { DestinationLink } from "@/components/marketing/DestinationLink";
import { MarketingAnalytics } from "@/components/marketing/MarketingAnalytics";
import { RequirementsList } from "@/components/marketing/RequirementsList";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { Steps } from "@/components/marketing/Steps";
import {
  findCityRow,
  getCityAvailability,
  listCities,
  rideFacts,
} from "@/lib/availability";

export const metadata: Metadata = {
  title: "Drive with UBI",
  description:
    "Apply in the UBI Driver app: what you need, what happens next, how your pay is shown.",
  alternates: { canonical: "https://www.ubi.africa/drive" },
};

/**
 * Board 24d / 24e. City from ?city= or the only live city, else the first
 * launch city. No earnings figures, no review-time promises; serviceFeePct from
 * city config is the only number.
 */
export default async function DrivePage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  await connection();
  const { city } = await searchParams;
  const rows = await listCities();
  const active = rows.filter((row) => row.status === "active");
  const launching = rows.filter((row) => row.status === "launching");
  const requested = city ? findCityRow(rows, city) : undefined;
  const row = requested ?? active[0] ?? launching[0] ?? rows[0];
  const cityId = row?.id;
  const availability = cityId ? await getCityAvailability(cityId) : undefined;
  const cityName = row?.name ?? cityId ?? "your city";
  const facts =
    availability?.status === "ok" ? rideFacts(availability.config) : undefined;
  const plannedCount = rows.filter((r) => r.status === "planned").length;

  return (
    <div className="min-h-screen bg-mk-canvas text-mk-ink">
      <SiteHeader current="drive" audience="driver" />
      <MarketingAnalytics />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[1440px] px-[18px] lg:px-[72px]"
      >
        <section className="grid items-start gap-6 py-7 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:py-[72px]">
          <div>
            <div className="mk-label mb-3 flex items-center gap-2 text-mk-forest lg:mb-4">
              <span
                aria-hidden
                className="h-[7px] w-[7px] rounded-full bg-mk-green"
              />
              Drivers · {cityName}
            </div>
            <h1 className="mk-h1 mb-3 lg:mb-[18px] lg:!text-[54px]">
              Drive with UBI in {cityName}
            </h1>
            <p className="mk-lead mb-5 max-w-[560px] lg:mb-7">
              Apply in the UBI Driver app. You upload your documents once, watch
              each one get reviewed, and go online when everything is verified.
              Your share of every fare is shown on the trip and on your weekly
              statement.
            </p>
            <div className="grid gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
              <DestinationLink
                to="driver"
                variant="green"
                testId="marketing.drive.applyCta"
                analytics="drive_apply"
              >
                Apply in the UBI Driver app
              </DestinationLink>
              <DestinationLink
                to="driver"
                variant="outline"
                analytics="drive_open"
              >
                Already applied? Open the app
              </DestinationLink>
            </div>
            <p className="mk-small mt-3 lg:mt-4">
              Applying is free. We never ask for payment to review documents.
            </p>
          </div>
          {cityId ? (
            <RequirementsList
              cityId={cityId}
              cityName={cityName}
              classes={facts?.classList}
            />
          ) : (
            <aside
              data-testid="marketing.drive.requirements"
              data-status="error"
              className="rounded-card-lg border border-mk-border bg-mk-surface p-7"
            >
              <h2 className="mk-h3 mb-1.5 !text-[22px]">
                What you&apos;ll need
              </h2>
              <p role="status" className="mk-small">
                The document list is shown inside the UBI Driver app when you
                apply.
              </p>
            </aside>
          )}
        </section>

        <div className="pb-12 lg:pb-14">
          <Steps
            heading="What happens next"
            items={[
              {
                title: "Create your account",
                body: "Phone number and a one-time code. No password to remember.",
              },
              {
                title: "Add your vehicle",
                body: "Make, model, year, plate. The app tells you which classes it qualifies for.",
              },
              {
                title: "Upload documents",
                body: "Photograph each one in the app. Each shows Under review, Verified, or Needs attention with the reason.",
              },
              {
                title: "Selfie check",
                body: "A short liveness check matches you to your ID. Repeated occasionally to keep accounts safe.",
              },
              {
                title: "Go online",
                body: "Once everything is verified you can take trips. Set your own hours.",
              },
            ]}
          />
          <p className="mk-small mt-3.5">
            Review times vary with volume; the app shows the live status of each
            document rather than a promised date.
          </p>
        </div>

        <section className="grid gap-[18px] pb-14 lg:grid-cols-2 lg:pb-16">
          <div
            data-testid="marketing.drive.pay"
            className="rounded-card-lg border border-mk-border bg-mk-surface p-6 lg:p-8"
          >
            <h2 className="mk-h2 mb-3 !text-[26px]">How your pay is shown</h2>
            <ul className="mk-body grid gap-3">
              <li className="flex gap-3">
                <Dot />
                <span>
                  Every trip shows the fare, UBI&apos;s service fee
                  {facts ? (
                    <>
                      {" "}
                      (
                      <b
                        className="text-mk-forest"
                        data-testid="marketing.drive.serviceFee"
                      >
                        {facts.serviceFeePct}% of the fare in {cityName}
                      </b>
                      )
                    </>
                  ) : null}{" "}
                  and what you keep. Before you accept the next one.
                </span>
              </li>
              <li className="flex gap-3">
                <Dot />
                <span>
                  Tips and tolls are yours; they&apos;re listed separately and
                  never commissioned.
                </span>
              </li>
              <li className="flex gap-3">
                <Dot />
                <span>
                  Cash trips: you keep the cash; what you owe UBI nets against
                  your wallet on the weekly statement.
                </span>
              </li>
              <li className="flex gap-3">
                <Dot />
                <span>
                  Any incentive UBI runs appears as its own line with its rules.
                  We don&apos;t advertise earnings here because they depend on
                  when and where you drive.
                </span>
              </li>
            </ul>
          </div>
          <div className="rounded-card-lg border border-mk-mint-border bg-mk-mint p-6 lg:p-8">
            <h2 className="mk-h2 mb-3 !text-[26px]">Safety works both ways</h2>
            <ul className="mk-body grid gap-3">
              <li className="flex gap-3">
                <Dot forest />
                <span>
                  Riders confirm the trip with a PIN, so you know you have the
                  right passenger.
                </span>
              </li>
              <li className="flex gap-3">
                <Dot forest />
                <span>
                  Emergency{facts ? ` ${facts.emergencyNumber}` : " services"}{" "}
                  and UBI Support are one tap away from the trip screen.
                </span>
              </li>
              <li className="flex gap-3">
                <Dot forest />
                <span>
                  Cancellations by riders after you&apos;re assigned are charged
                  to them, not to you.
                </span>
              </li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <DestinationLink
                to="driver"
                variant="green"
                analytics="drive_apply_bottom"
              >
                Apply in the UBI Driver app
              </DestinationLink>
              <a
                href="/help#drivers"
                className="inline-flex min-h-cta items-center justify-center rounded-cta border-[1.5px] border-mk-forest bg-mk-surface px-6 py-4 text-base font-semibold text-mk-forest hover:bg-mk-mint"
              >
                Driver help
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter cities={active} plannedCount={plannedCount} />
    </div>
  );
}

function Dot({ forest }: { forest?: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-[7px] h-2.5 w-2.5 flex-none rounded-full ${
        forest ? "bg-mk-forest" : "bg-mk-green"
      }`}
    />
  );
}
