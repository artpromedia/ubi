import Link from "next/link";
import { Card, Button } from "@ubi/ui";
import { formatMoney, type FlightOffer } from "./types";

export type { FlightOffer, Money } from "./types";

const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  });

/** Board 23f — one row per offer, fare families side by side; "price guaranteed" only from the adapter field. */
export function OfferRow({ offer }: { offer: FlightOffer }) {
  return (
    <Card className="grid grid-cols-[1.3fr_1fr_1fr_auto] items-center gap-3.5 rounded-2xl p-4">
      <div>
        <div className="text-lg font-semibold tabular-nums text-[#191414]">
          {hm(offer.departAt)} → {hm(offer.arriveAt)}
        </div>
        <div className="text-xs text-[#666]">
          {offer.carrier} {offer.flightNumber} · {Math.floor(offer.durationMin / 60)}h{" "}
          {String(offer.durationMin % 60).padStart(2, "0")}m
          {offer.departTerminal
            ? " · " + offer.departTerminal + " → " + offer.arriveTerminal
            : ""}
        </div>
        {offer.capabilities.priceGuaranteeUntil ? (
          <div className="mt-1 text-[11px] text-[#2B6CB0]">
            Price guaranteed to {hm(offer.capabilities.priceGuaranteeUntil)} if you book now ·
            not a seat reservation
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-[#B8860B]">
            Price can change until you pay — no seat is held.
          </div>
        )}
      </div>
      {offer.soldOut ? (
        <div className="col-span-2 text-sm font-semibold text-[#C53030]">
          {offer.soldOutNote ?? "Sold out"}
        </div>
      ) : (
        offer.fareFamilies.slice(0, 2).map((f) => (
          <div key={f.id} className="rounded-xl border border-[#E5E5E5] p-2.5">
            <div className="flex justify-between text-[12.5px] font-semibold text-[#191414]">
              <span>{f.name}</span>
              <span className="tabular-nums">{formatMoney(f.price)}</span>
            </div>
            <div className="text-[11.5px] text-[#666]">
              {f.baggage} · {f.changeRule} · {f.refundRule}
            </div>
          </div>
        ))
      )}
      <Button
        asChild
        variant={offer.soldOut ? "outline" : "default"}
        disabled={offer.soldOut}
        className="h-11 rounded-xl bg-[#191414] text-white"
      >
        <Link href={"/travel/checkout?offer=" + offer.offerRef}>Select</Link>
      </Button>
    </Card>
  );
}
