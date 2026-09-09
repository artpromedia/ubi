"use client";
import { Card, Badge } from "@ubi/ui";
import { useTrip } from "@/components/travel/api";
import type { TripItemStatus } from "@/components/travel/types";

const PILL: Record<TripItemStatus, string> = {
  ticketed: "bg-[#E8F8EE] text-[#148F3D]",
  confirmed: "bg-[#E8F8EE] text-[#148F3D]",
  completed: "bg-[#E8F8EE] text-[#148F3D]",
  assigned: "bg-[#E8F8EE] text-[#148F3D]",
  reserved: "bg-[#E8F8EE] text-[#148F3D]",
  supplier_pending: "bg-[#FEF6E8] text-[#B8860B]",
  not_reserved: "bg-[#FDE8E8] text-[#C53030]",
  cancelled: "bg-[#FDE8E8] text-[#C53030]",
  refunded: "bg-[#FDE8E8] text-[#C53030]",
  not_booked: "bg-[#F5F5F5] text-[#666]",
};

/** Board 23f (mobile web) — booking management from an SMS link; rides need the app (live tracking) and say so; everything else works here. */
export function TripItems({ tripId }: { tripId: string }) {
  const { data: trip, isPending, isError } = useTrip(tripId);

  if (isPending) {
    return <p className="p-4 text-[12.5px] text-[#666]">Loading your trip…</p>;
  }
  if (isError || !trip) {
    return (
      <p className="p-4 text-[12.5px] text-[#C53030]">
        We couldn&apos;t load this trip. The link may have expired — open the UBI app to
        manage it.
      </p>
    );
  }

  return (
    <>
      <h1 className="font-heading text-xl font-semibold text-[#191414]">
        {trip.title} · {trip.dates}
      </h1>
      <p className="text-[12.5px] text-[#666]">
        All times {trip.timezone} · you&apos;re on the web version
      </p>
      {trip.items.map((it, i) => (
        <Card key={it.orderId ?? it.reservationId ?? it.title + i} className="space-y-1.5 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            {it.dateLabel ? (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#2B6CB0]">
                {it.dateLabel}
              </span>
            ) : (
              <span />
            )}
            <Badge className={"text-[10px] uppercase " + PILL[it.status]}>
              {it.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="text-[15px] font-semibold text-[#191414]">{it.title}</div>
          {it.subtitle ? <div className="text-xs text-[#666]">{it.subtitle}</div> : null}
          {it.refs ? <div className="text-xs text-[#666]">{it.refs}</div> : null}
          {it.kind === "ride_reservation" ? (
            <p className="text-xs text-[#666]">
              Rides are booked in the app (live driver tracking needs it). We&apos;ll remind
              you on landing.{" "}
              <a
                className="font-semibold text-[#18A349]"
                href={"https://links.ubi.africa/trips/" + tripId}
              >
                Get the app
              </a>{" "}
              · or continue on web without it.
            </p>
          ) : it.actions && it.actions.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {it.actions.map((a) => (
                <a
                  key={a.key}
                  href={"/trips/" + tripId + "/" + a.key}
                  className="rounded-full border border-[#E5E5E5] px-3 py-2 text-xs font-semibold text-[#191414]"
                >
                  {a.label}
                </a>
              ))}
            </div>
          ) : null}
        </Card>
      ))}
    </>
  );
}
