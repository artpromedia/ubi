/**
 * The city registry the marketing site and the ops console render from.
 *
 * Launch plan (owner, 13 Sep 2026): Lagos and Abuja launch together, on the
 * same day, and carry status `launching` until then; eight further cities are
 * `planned` (named as intent, no dates). A `launchGroup` ties the two launch
 * cities together: `setCityStatus` refuses to activate one without the other
 * (`launch_pair_incomplete`).
 *
 * `active` is derived from `status` on every write; it survives only for
 * readers that predate `status`.
 */
import { type CityStatus, cityIsActive } from "@ubi/contracts";

import type { Tx } from "../services/audit";

export interface SeedCity {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly region: string;
  readonly timezone: string;
  readonly status: CityStatus;
  readonly launchGroup: string | null;
}

/** Lagos and Abuja go live together. */
export const NG_LAUNCH_GROUP = "ng-launch-2026";

export const LAGOS_CITY: SeedCity = {
  id: "LOS",
  name: "Lagos",
  country: "NG",
  region: "Lagos State",
  timezone: "Africa/Lagos",
  status: "launching",
  launchGroup: NG_LAUNCH_GROUP,
};

export const ABUJA_CITY: SeedCity = {
  id: "ABV",
  name: "Abuja",
  country: "NG",
  region: "FCT",
  timezone: "Africa/Lagos",
  status: "launching",
  launchGroup: NG_LAUNCH_GROUP,
};

/**
 * Expansion, in no particular order. Ids are IATA codes where the city has an
 * airport; Onitsha has none, so `ONI` is an internal id.
 */
export const PLANNED_CITIES: readonly SeedCity[] = [
  { id: "PHC", name: "Port Harcourt", region: "Rivers State" },
  { id: "IBA", name: "Ibadan", region: "Oyo State" },
  { id: "BNI", name: "Benin City", region: "Edo State" },
  { id: "ENU", name: "Enugu", region: "Enugu State" },
  { id: "QUO", name: "Uyo", region: "Akwa Ibom State" },
  { id: "CBQ", name: "Calabar", region: "Cross River State" },
  { id: "ABB", name: "Asaba", region: "Delta State" },
  { id: "ONI", name: "Onitsha", region: "Anambra State" },
].map((city) => ({
  ...city,
  country: "NG",
  timezone: "Africa/Lagos",
  status: "planned" as const,
  launchGroup: null,
}));

export const SEED_CITIES: readonly SeedCity[] = [
  LAGOS_CITY,
  ABUJA_CITY,
  ...PLANNED_CITIES,
];

/**
 * Creates the row with its seed status, or refreshes the descriptive fields of
 * an existing row WITHOUT touching `status`: a re-run of the seed must never
 * pull a city that ops activated back to `launching`.
 */
export async function upsertCityRow(tx: Tx, city: SeedCity): Promise<void> {
  await tx.city.upsert({
    where: { id: city.id },
    create: {
      id: city.id,
      name: city.name,
      country: city.country,
      region: city.region,
      timezone: city.timezone,
      status: city.status,
      launchGroup: city.launchGroup,
      active: cityIsActive(city.status),
    },
    update: {
      name: city.name,
      region: city.region,
      timezone: city.timezone,
      launchGroup: city.launchGroup,
    },
  });
}
