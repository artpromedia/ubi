import type { Metadata } from "next";
import { connection } from "next/server";

import { DestinationLink } from "@/components/marketing/DestinationLink";
import { Faq } from "@/components/marketing/Faq";
import { MarketingAnalytics } from "@/components/marketing/MarketingAnalytics";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { getCityAvailability, listCities } from "@/lib/availability";

export const metadata: Metadata = {
  title: "Help",
  description:
    "Support is inside the UBI apps. Urgent numbers, where to get help for rides, driving and travel bookings.",
  alternates: { canonical: "/help" },
};

/**
 * Board 24g. Routes people to in-app support; the emergency number comes from
 * city config and the safety line from the environment; static answers name
 * where to go, never account data.
 */
export default async function HelpPage() {
  await connection();
  const rows = await listCities();
  const cities = rows.filter((row) => row.status === "active");
  const plannedCount = rows.filter((row) => row.status === "planned").length;
  const first = cities[0] ? await getCityAvailability(cities[0].id) : undefined;
  const emergency =
    first?.status === "ok" ? first.config.emergencyNumber : undefined;
  const safetyLine = process.env.UBI_SUPPORT_PHONE?.trim();

  return (
    <div className="min-h-screen bg-mk-canvas text-mk-ink">
      <SiteHeader current="help" />
      <MarketingAnalytics />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[1440px] px-[18px] py-10 lg:px-[72px] lg:py-16"
      >
        <h1 className="mk-h1 mb-3 lg:!text-[48px]">Help</h1>
        <p className="mk-lead mb-7 max-w-[640px]">
          Support is inside the UBI apps, where it can see your trip, order or
          booking. Open the item in the app and tap Get help; a person answers
          24/7.
        </p>
        <section
          aria-label="Urgent"
          data-testid="marketing.help.urgent"
          className="mk-on-forest mb-7 flex flex-wrap items-center gap-7 rounded-card bg-mk-forest px-7 py-6 text-mk-on-forest"
        >
          <div className="min-w-[260px] flex-1">
            <div className="mk-label mb-1.5 text-mk-on-forest-muted">
              In danger right now
            </div>
            {emergency ? (
              <a
                href={`tel:${emergency}`}
                data-testid="marketing.help.emergency"
                className="font-heading text-2xl font-semibold text-mk-on-forest"
              >
                Call {emergency}
              </a>
            ) : (
              <div
                className="font-heading text-2xl font-semibold"
                data-testid="marketing.help.emergency"
              >
                Call your local emergency number
              </div>
            )}
            <p className="text-sm text-mk-on-forest-muted">
              {emergency
                ? "Nigeria's emergency number, also one tap away on every trip screen."
                : "It is also one tap away on every trip screen."}
            </p>
          </div>
          <div className="min-w-[260px] flex-1">
            <div className="mk-label mb-1.5 text-mk-on-forest-muted">
              UBI safety line
            </div>
            {safetyLine ? (
              <a
                href={`tel:${safetyLine.replace(/\s/g, "")}`}
                data-testid="marketing.help.safetyLine"
                className="font-heading text-2xl font-semibold text-mk-on-forest"
              >
                {safetyLine}
              </a>
            ) : (
              <div
                className="font-heading text-2xl font-semibold"
                data-testid="marketing.help.safetyLinePending"
              >
                Published at launch
              </div>
            )}
            <p className="text-sm text-mk-on-forest-muted">
              {safetyLine
                ? "For safety concerns during or after a trip."
                : "The number appears here when the line is live; until then use Get help in the app."}
            </p>
          </div>
        </section>

        <div
          data-testid="marketing.help.entries"
          className="mb-9 grid gap-[18px] lg:grid-cols-3"
        >
          <Entry
            id="riders"
            title="Riders"
            body="Open the trip, order or booking in Activity and tap Get help. Support sees the receipt and the route, so you don't have to explain them."
          >
            <DestinationLink to="rider" variant="forest" analytics="help_rider">
              Open UBI
            </DestinationLink>
          </Entry>
          <Entry
            id="drivers"
            title="Drivers"
            body="In the UBI Driver app, open Account then Support. Document decisions, statements and trip disputes are handled there with the record in front of the agent."
          >
            <DestinationLink
              to="driver"
              variant="green"
              analytics="help_driver"
            >
              Open UBI Driver
            </DestinationLink>
          </Entry>
          <Entry
            id="travel"
            title="Travel bookings"
            body="Open the trip in Activity. Each flight, hotel and ride shows its own status, deadline and refund path; Get help attaches the booking reference for you."
          >
            <DestinationLink
              to="rider"
              path="/trips"
              variant="outline"
              analytics="help_travel"
            >
              Open your trips
            </DestinationLink>
          </Entry>
        </div>

        <div className="mb-8 grid gap-[18px] lg:grid-cols-3">
          <section aria-labelledby="hr">
            <h2 id="hr" className="mk-h3 mb-1.5">
              Riding
            </h2>
            <Faq
              items={[
                {
                  q: "I was charged the wrong amount",
                  a: "Open the trip in Activity and tap Get help, then Fare. The receipt lists every line; if the route or waiting time is wrong, support corrects the fare and the difference returns to your payment method or wallet.",
                },
                {
                  q: "I left something in the car",
                  a: "Open the trip and tap Get help, then Lost item. Support contacts the driver for you; your phone number is not shared.",
                },
                {
                  q: "My ride was cancelled but I was charged",
                  a: "A rider cancellation fee applies only after a driver is assigned and the free window has passed; a driver cancellation is never charged to you. Open the trip to see which applied and to dispute it.",
                },
                {
                  q: "Where is my refund?",
                  a: "Refunds appear in Activity with their own status until the money is back in your wallet or on your card.",
                },
              ]}
            />
          </section>
          <section aria-labelledby="hd">
            <h2 id="hd" className="mk-h3 mb-1.5">
              Driving
            </h2>
            <Faq
              items={[
                {
                  q: "A document was rejected",
                  a: "Documents shows the reason and what to upload instead. Re-upload from the same screen; review restarts automatically.",
                },
                {
                  q: "My statement doesn't match my trips",
                  a: "Every statement line links to its trip and ledger entry. Open the line, then Get help, and support sees the same record.",
                },
                {
                  q: "I can't go online",
                  a: "The home screen tells you why: an expired document, a vehicle check, or an identity check that needs repeating. Fix the item it names.",
                },
                {
                  q: "A rider didn't pay cash",
                  a: "Mark the trip as unpaid within the app; support reviews it and the amount is not netted against your wallet while it is under review.",
                },
              ]}
            />
          </section>
          <section aria-labelledby="ht">
            <h2 id="ht" className="mk-h3 mb-1.5">
              Travel
            </h2>
            <Faq
              items={[
                {
                  q: "My flight was changed or cancelled",
                  a: "The trip shows the airline's options and, where your fare qualifies, UBI's. Choose in the app; nothing is rebooked without you.",
                },
                {
                  q: "I need to change a hotel booking",
                  a: "Open the stay and tap Change. The cancellation deadline and any charge are shown before you confirm.",
                },
                {
                  q: "I have a PNR but no ticket number",
                  a: "A PNR is the airline's confirmation; the e-ticket number follows and is what lets you fly. The booking shows both steps; if the ticket is late, support chases the airline and your money stays held, not taken.",
                },
              ]}
            />
          </section>
        </div>

        <div className="grid gap-[18px] lg:grid-cols-2">
          <section className="rounded-card border border-mk-border bg-mk-surface p-6">
            <h2 className="mk-h3 mb-1.5 !text-[20px]">
              Report a safety concern
            </h2>
            <p className="mk-body">
              Use Get help on the trip so the report is tied to the driver,
              vehicle and route. Reports are read by a person; you get a case
              number and a reply in the app.
            </p>
          </section>
          <section className="rounded-card border border-mk-border bg-mk-surface p-6">
            <h2 className="mk-h3 mb-1.5 !text-[20px]">Your data</h2>
            <p className="mk-body mb-2">
              Download or delete your data from Account, then Privacy, in the
              app. The privacy policy explains what we keep and for how long.
            </p>
            <DestinationLink to="privacy" variant="text">
              Privacy policy
            </DestinationLink>
          </section>
        </div>
      </main>
      <SiteFooter cities={cities} plannedCount={plannedCount} />
    </div>
  );
}

function Entry({
  id,
  title,
  body,
  children,
}: {
  id: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <article
      id={id}
      className="flex flex-col gap-2.5 rounded-card border border-mk-border bg-mk-surface p-6"
    >
      <h2 className="mk-h3">{title}</h2>
      <p className="mk-body flex-1">{body}</p>
      {children}
    </article>
  );
}
