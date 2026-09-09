"use client";
import { useState } from "react";
import { Button, Card } from "@ubi/ui";
import { AskPanel } from "@/components/travel/AskPanel";
import { OfferRow } from "@/components/travel/OfferRow";
import { useFlightSearch } from "@/components/travel/api";

type SortKey = "cheapest" | "earliest" | "refundable" | "bag";

/** Board 23f (desktop) — travel search with Ask UBI beside it. Same server contracts as RN (travel-v2.yaml). */
export default function TravelPage() {
  const [q, setQ] = useState({
    from: "LOS",
    to: "ABV",
    departDate: "2026-09-12",
    returnDate: "2026-09-14",
    passengers: "1",
  });
  const [sort, setSort] = useState<SortKey>("cheapest");
  const search = useFlightSearch();

  const runSearch = () =>
    search.mutate({
      from: q.from,
      to: q.to,
      departDate: q.departDate,
      returnDate: q.returnDate.trim() ? q.returnDate : undefined,
      passengers: Number.parseInt(q.passengers, 10) || 1,
    });

  const field = (k: keyof typeof q, label: string) => (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#999]">
        {label}
      </span>
      <input
        value={q[k]}
        onChange={(e) => setQ({ ...q, [k]: e.target.value })}
        className="w-full bg-transparent text-sm font-semibold text-[#191414] outline-none"
      />
    </label>
  );

  return (
    <div className="flex gap-5 p-7">
      <section className="min-w-0 flex-1 space-y-3">
        <Card className="grid grid-cols-[1.2fr_1.2fr_1fr_1fr_.8fr_auto] items-end gap-3 rounded-2xl p-4">
          {field("from", "From")}
          {field("to", "To")}
          {field("departDate", "Depart")}
          {field("returnDate", "Return")}
          {field("passengers", "Who")}
          <Button
            onClick={runSearch}
            disabled={search.isPending}
            className="h-11 rounded-xl bg-[#1DB954] text-[#191414] hover:bg-[#18A349]"
          >
            {search.isPending ? "Searching…" : "Search"}
          </Button>
        </Card>
        <div className="flex items-center gap-1.5">
          {(["cheapest", "earliest", "refundable", "bag"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={
                "rounded-full px-3 py-1.5 text-[11.5px] font-semibold " +
                (sort === k
                  ? "bg-[#191414] text-white"
                  : "border border-[#E5E5E5] bg-white text-[#191414]")
              }
            >
              {k === "bag" ? "Bag included" : k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
          ))}
          {search.data ? (
            <span className="ml-auto text-xs text-[#666]">
              {search.data.offers.length} flights · prices as of{" "}
              {new Date(search.data.pricesAsOf).toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · WAT
            </span>
          ) : null}
        </div>
        {search.isError ? (
          <p className="text-sm text-[#C53030]">
            We couldn&apos;t load flights just now. Check your dates and try again.
          </p>
        ) : null}
        {search.data?.offers.map((o) => <OfferRow key={o.offerRef} offer={o} />)}
        {!search.data && !search.isPending ? (
          <p className="text-sm text-[#666]">
            Domestic flights only for now. Prices include taxes; UBI&apos;s service fee per
            ticket is shown before you pay.
          </p>
        ) : null}
      </section>
      <AskPanel context={{ searchId: search.data?.searchId }} />
    </div>
  );
}
