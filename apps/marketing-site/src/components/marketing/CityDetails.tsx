import {
  getCityAvailability,
  joinNames,
  liveServices,
  rideFacts,
} from "@/lib/availability";

import { Faq } from "./Faq";
import { Steps } from "./Steps";

/**
 * Below the grid: how a ride works, built-in safety and the FAQ. All three
 * depend on flags (a ride section only when rides are live; a travel answer
 * only when travel is live), so they stream behind one Suspense boundary.
 */
export async function CityDetails({
  cityId,
  cityName,
  region,
}: {
  cityId: string;
  cityName: string;
  region: string | null;
}) {
  const availability = await getCityAvailability(cityId);
  const ok = availability.status === "ok";
  const live = ok ? liveServices(availability.services) : [];
  const facts = ok ? rideFacts(availability.config) : undefined;
  const ridesLive = live.includes("move") && facts !== undefined;

  return (
    <>
      {ridesLive ? (
        <section
          className="grid gap-[18px] pb-12 lg:grid-cols-2 lg:pb-16"
          data-testid="marketing.city.rideSections"
        >
          <Steps
            tone="forest"
            heading={`How a ride works in ${cityName}`}
            items={[
              {
                title: "Set where you're going",
                body: `Choose ${joinNames(facts.classList).replace(" and ", " or ")}. The price is shown before you confirm and is set when a driver is assigned.`,
              },
              {
                title: "Check the plate, share the PIN",
                body: "Your driver's name and plate appear in the app. The trip starts only after your 4-digit PIN is entered.",
              },
              {
                title: "Pay how you like",
                body: `${joinNames(facts.payList)}. Your receipt lists every line.`,
              },
            ]}
          />
          <section
            className="rounded-card-lg border border-mk-border bg-mk-surface p-6 lg:p-9"
            aria-labelledby="safety-h"
          >
            <h2 id="safety-h" className="mk-h2 mb-5">
              Built-in safety
            </h2>
            <ul className="mk-body grid gap-3.5">
              {[
                ["PIN-verified pickup", "The wrong car can't start your trip."],
                [
                  "Share your trip",
                  "with a trusted contact from the trip screen.",
                ],
                [
                  `Emergency ${facts.emergencyNumber}`,
                  "one tap away during a ride; UBI Support is in the app 24/7.",
                ],
                [
                  "Verified drivers",
                  "Licence, identity, insurance, roadworthiness and background check are reviewed before anyone goes online.",
                ],
              ].map(([title, text]) => (
                <li key={title} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-[7px] h-2.5 w-2.5 flex-none rounded-full bg-mk-green"
                  />
                  <span>
                    <b className="text-mk-forest">{title}</b>. {text}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mk-small mt-[18px]">
              We describe what the app does; we don&apos;t publish safety
              statistics we can&apos;t verify.
            </p>
          </section>
        </section>
      ) : null}
      <section
        className="max-w-[900px] pb-14 lg:pb-[72px]"
        aria-labelledby="faq-h"
      >
        <h2 id="faq-h" className="mk-h2 mb-4">
          Questions
        </h2>
        <Faq
          items={[
            {
              q: `Where in ${cityName} can I ride?`,
              a: `Anywhere in ${region ?? cityName} where a driver is nearby. The app shows the estimated wait before you request; if no driver is available it tells you instead of holding a request open.`,
            },
            {
              q: "Is the fare fixed?",
              a: "The fare is set when a driver is assigned and shown before you confirm. Waiting beyond the free time and route changes you ask for are listed on the receipt.",
            },
            {
              q: "Can I pay cash?",
              a:
                facts && facts.cashAccepted
                  ? `Yes. ${joinNames(facts.payList)} are all accepted in ${cityName}.`
                  : `Payment methods available in ${cityName} are listed in the app before you confirm.`,
            },
            live.includes("travel")
              ? {
                  q: "Can I book a flight or hotel through UBI?",
                  a: "Yes. Domestic flights and hotels are booked in the app with the full price and every term shown before you pay. Each booking has its own status, cancellation deadline and refund path.",
                }
              : {
                  q: `When do the other services start in ${cityName}?`,
                  a: "We don't announce dates. The cards above switch to Live the day a service is on, and the app shows the same.",
                },
          ]}
        />
      </section>
    </>
  );
}
