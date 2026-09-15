import { getDriverRequirements } from "@/lib/requirements";

import { DestinationLink } from "./DestinationLink";

/**
 * Board 24d right column. Server component; the list comes from user-service.
 * When it cannot be fetched the list is hidden (never guessed) and the CTA
 * remains. The vehicle line comes from city config (classes), not from a
 * constant.
 */
export async function RequirementsList({
  cityId,
  cityName,
  classes,
}: {
  cityId: string;
  cityName: string;
  classes?: readonly string[];
}) {
  const requirements = await getDriverRequirements(cityId);
  const items =
    requirements.status === "ok"
      ? [
          ...requirements.items,
          ...(classes && classes.length > 0
            ? [
                {
                  id: "vehicle",
                  title: `A car for ${classes.join(", ").replace(/, ([^,]*)$/, " or $1")}`,
                  detail:
                    "Class eligibility is confirmed from your vehicle details in the app",
                },
              ]
            : []),
        ]
      : [];
  return (
    <aside
      data-testid="marketing.drive.requirements"
      data-status={requirements.status}
      className="rounded-card-lg border border-mk-border bg-mk-surface p-7"
      aria-labelledby="req-h"
    >
      <h2 id="req-h" className="mk-h3 mb-1.5 !text-[22px]">
        What you&apos;ll need in {cityName}
      </h2>
      {requirements.status === "ok" ? (
        <>
          <p className="mk-small mb-4">
            The exact list comes from UBI&apos;s verification rules for{" "}
            {cityName} and is repeated inside the app.
          </p>
          <ul className="grid gap-2.5">
            {items.map((item, index) => (
              <li
                key={item.id}
                className={`flex gap-3 py-2.5 ${
                  index < items.length - 1 ? "border-b border-mk-divider" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-mk-mint text-xs font-bold text-mk-forest"
                >
                  {index + 1}
                </span>
                <span className="mk-body">
                  <b className="text-mk-forest">{item.title}</b>
                  {item.detail ? `. ${item.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status" className="mk-small">
          The document list is shown inside the UBI Driver app when you apply.
        </p>
      )}
      <p className="mk-small mt-3.5">
        Own several cars?{" "}
        <DestinationLink to="fleetContact" variant="text">
          Fleet arrangements are agreed with UBI directly.
        </DestinationLink>
      </p>
    </aside>
  );
}
