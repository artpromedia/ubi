import { Suspense } from "react";

import { getCityAvailability, rideFacts } from "@/lib/availability";

import { AvailabilityNotice } from "./AvailabilityNotice";
import { ServiceCard, type ServiceFact } from "./ServiceCard";

/**
 * Board 24a grid, 24c skeleton and unknown state. Server component behind
 * Suspense so the hero and CTAs stream first while flags resolve.
 */
export function ServicesGrid({ cityId }: { cityId: string }) {
  return (
    <Suspense fallback={<ServicesSkeleton />}>
      <ServicesGridInner cityId={cityId} />
    </Suspense>
  );
}

async function ServicesGridInner({ cityId }: { cityId: string }) {
  const availability = await getCityAvailability(cityId);
  if (availability.status !== "ok") {
    const name =
      availability.status === "error" && availability.cityName
        ? availability.cityName
        : cityId.toUpperCase();
    return <AvailabilityNotice cityName={name} />;
  }
  const facts = rideFacts(availability.config);
  const moveFacts: ServiceFact[] = [
    { label: "Classes", value: facts.classes },
    { label: "Pay with", value: facts.payWith },
    { label: "Pickup", value: facts.pickup },
    ...(facts.airport ? [{ label: "Airport", value: facts.airport }] : []),
    { label: "Emergency", value: facts.emergency },
  ];
  return (
    <div
      data-testid="marketing.city.services"
      className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3"
    >
      {availability.services.map((service) => (
        <ServiceCard
          key={service.key}
          service={service}
          cityName={availability.cityName}
          wide={service.key === "move" && service.status === "live"}
          facts={service.key === "move" ? moveFacts : undefined}
        />
      ))}
    </div>
  );
}

function ServicesSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Checking what's available"
      data-testid="marketing.city.servicesLoading"
      className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3"
    >
      {[0, 1, 2].map((slot) => (
        <div
          key={slot}
          className="h-[180px] rounded-card border border-mk-border bg-mk-surface p-6 motion-safe:animate-pulse"
        >
          <div className="mb-3 h-6 w-28 rounded-full bg-mk-skeleton" />
          <div className="mb-2 h-6 w-40 rounded bg-mk-skeleton" />
          <div className="h-3.5 w-full rounded bg-mk-skeleton" />
        </div>
      ))}
    </div>
  );
}
