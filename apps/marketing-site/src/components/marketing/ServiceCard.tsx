import Image from "next/image";
import { Fragment } from "react";

import type { ServiceInfo } from "@/lib/availability";

import { DestinationLink } from "./DestinationLink";
import { StatusPill } from "./StatusPill";

interface ServiceMeta {
  readonly title: string;
  readonly logo?: string;
  readonly liveBody: string;
  readonly notYetBody: (city: string) => string;
  readonly cityScoped: boolean;
}

const META: Record<ServiceInfo["key"], ServiceMeta> = {
  move: {
    title: "Rides",
    logo: "/brand/ubi-move-logo.svg",
    liveBody:
      "Request now. You see the driver's name, plate and a 4-digit PIN before they arrive; the fare is set when a driver is assigned and shown before you confirm.",
    notYetBody: (city) => `Rides are not switched on in ${city} yet.`,
    cityScoped: true,
  },
  bites: {
    title: "Food delivery",
    logo: "/brand/ubi-bites-logo.svg",
    liveBody:
      "Order from restaurants near you. The delivery fee and total are shown before you order; follow the courier to your door and pay with the same methods as a ride.",
    notYetBody: (city) =>
      `Bites isn't switched on in ${city}. This card changes the day it is. We don't take orders or sign-ups for it before then.`,
    cityScoped: true,
  },
  send: {
    title: "Package delivery",
    logo: "/brand/ubi-send-logo.svg",
    liveBody:
      "Send a package across town. Price shown before you confirm, live tracking, and proof of delivery at handover. The recipient is told what's coming and when.",
    notYetBody: (city) => `Send isn't switched on in ${city} yet.`,
    cityScoped: true,
  },
  travel: {
    title: "Flights & stays",
    liveBody:
      "Domestic flights and hotels. The full price and every term are shown before you pay; each booking has its own status, cancellation deadline and refund path, and you can attach an airport ride.",
    notYetBody: () =>
      "Domestic flights and hotels are being built into UBI. Nothing is bookable yet.",
    cityScoped: false,
  },
  ask: {
    title: "Ask UBI",
    liveBody:
      "Ask about your account or plan a trip; bookings happen only after you review the exact terms.",
    notYetBody: () =>
      "An assistant that answers policy questions and books only after you review the exact terms. Not switched on yet.",
    cityScoped: false,
  },
};

export interface ServiceFact {
  readonly label: string;
  readonly value: string;
}

function LiveLink({
  service,
  cityName,
}: {
  service: ServiceInfo["key"];
  cityName: string;
}) {
  switch (service) {
    case "move":
      return (
        <DestinationLink to="rider" variant="text" analytics="ride_card">
          Ride in {cityName} →
        </DestinationLink>
      );
    case "bites":
      return (
        <DestinationLink to="rider" variant="text" analytics="bites_card">
          Order in {cityName} →
        </DestinationLink>
      );
    case "send":
      return (
        <DestinationLink to="rider" variant="text" analytics="send_card">
          Send in {cityName} →
        </DestinationLink>
      );
    case "travel":
      return (
        <DestinationLink
          to="rider"
          path="/travel"
          variant="text"
          analytics="travel_card"
        >
          Book travel →
        </DestinationLink>
      );
    default:
      return null;
  }
}

export function ServiceCard({
  service,
  cityName,
  facts,
  wide,
}: {
  service: ServiceInfo;
  cityName: string;
  facts?: readonly ServiceFact[];
  wide?: boolean;
}) {
  const meta = META[service.key];
  const live = service.status === "live";
  return (
    <article
      data-testid={`marketing.service.${service.key}`}
      data-status={service.status}
      aria-labelledby={`svc-${service.key}`}
      className={`${
        live
          ? "border border-mk-border"
          : "border border-dashed border-mk-border-dashed"
      } rounded-card bg-mk-surface p-6 ${
        wide ? "lg:col-span-2 lg:grid lg:grid-cols-2 lg:gap-5" : ""
      }`}
    >
      <div>
        <div className="mb-3 flex items-center gap-2.5">
          {meta.logo ? (
            <Image
              src={meta.logo}
              alt={`UBI ${meta.title}`}
              width={80}
              height={26}
              className={
                live ? "h-[26px] w-auto" : "h-[26px] w-auto opacity-75"
              }
            />
          ) : null}
          <StatusPill
            status={live ? "live" : "not_yet"}
            label={
              live
                ? "Live"
                : meta.cityScoped
                  ? `Not yet in ${cityName}`
                  : "Not yet available"
            }
          />
        </div>
        <h3 id={`svc-${service.key}`} className="mk-h3 mb-2">
          {meta.title}
        </h3>
        <p className={live ? "mk-body mb-3.5" : "mk-body text-mk-muted"}>
          {live ? meta.liveBody : meta.notYetBody(cityName)}
        </p>
        {live ? <LiveLink service={service.key} cityName={cityName} /> : null}
      </div>
      {live && facts && facts.length > 0 ? (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2.5 rounded-[14px] bg-mk-canvas p-4 text-sm lg:mt-0">
          {facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt className="text-mk-muted">{fact.label}</dt>
              <dd className="m-0 font-semibold text-mk-forest">{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </article>
  );
}
