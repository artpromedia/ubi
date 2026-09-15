import { DestinationLink } from "./DestinationLink";

/**
 * Board 24c "availability unknown": no service cards (a card is a claim); the
 * CTAs stay because the apps tell their own truth.
 */
export function AvailabilityNotice({ cityName }: { cityName: string }) {
  return (
    <div
      role="status"
      data-testid="marketing.city.availabilityUnknown"
      className="max-w-2xl space-y-4"
    >
      <p className="rounded-[12px] border border-mk-warn-border bg-mk-warn-bg px-3.5 py-3 text-[15px] leading-relaxed text-mk-ink">
        <b className="text-mk-warn-ink">
          We can&apos;t confirm what&apos;s available in {cityName} right now.
        </b>{" "}
        Our configuration service didn&apos;t respond. The app always shows the
        current truth. Open it to check.
      </p>
      <div className="flex flex-wrap gap-2.5">
        <DestinationLink to="rider" analytics="ride_unknown">
          Open UBI
        </DestinationLink>
        <DestinationLink
          to="driver"
          variant="outline"
          analytics="drive_unknown"
        >
          Drive with UBI
        </DestinationLink>
      </div>
    </div>
  );
}
