/**
 * Pure helpers shared by the server-only availability reader and the unit
 * tests: which flags make a service "live", and which config fields a card may
 * print. Nothing here reads the network or the environment.
 */
import {
  type CityConfig,
  type FlagKey,
  type FlagSet,
  isEnabled,
} from "@ubi/contracts";

export type ServiceKey = "move" | "bites" | "send" | "travel" | "ask";
export type ServiceStatus = "live" | "not_yet";
export interface ServiceInfo {
  readonly key: ServiceKey;
  readonly status: ServiceStatus;
}

/**
 * A service is "live" only when its flag is on. Rides additionally require
 * ride_request (no requests ⇒ nothing to sell). Travel is live when either
 * booking flag or the legacy travel flag is on.
 */
export function servicesFrom(flags: FlagSet): ServiceInfo[] {
  const on = (key: FlagKey): boolean => isEnabled(flags, key);
  return [
    {
      key: "move",
      status: on("move") && on("ride_request") ? "live" : "not_yet",
    },
    { key: "bites", status: on("bites") ? "live" : "not_yet" },
    { key: "send", status: on("send") ? "live" : "not_yet" },
    {
      key: "travel",
      status:
        on("flights_booking") || on("stays_booking") || on("travel")
          ? "live"
          : "not_yet",
    },
    { key: "ask", status: on("ai_assistant") ? "live" : "not_yet" },
  ];
}

export const SERVICE_LABEL: Record<ServiceKey, string> = {
  move: "rides",
  bites: "food delivery",
  send: "package delivery",
  travel: "flights and stays",
  ask: "Ask UBI",
};

export function liveServices(services: readonly ServiceInfo[]): ServiceKey[] {
  return services.filter((s) => s.status === "live").map((s) => s.key);
}

/** Human list: "rides, food delivery and package delivery". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface RideFacts {
  readonly classes: string;
  readonly classList: readonly string[];
  readonly payWith: string;
  readonly payList: readonly string[];
  readonly cashAccepted: boolean;
  readonly pickup: string;
  readonly airport: string | undefined;
  readonly airportCodes: string;
  readonly emergency: string;
  readonly emergencyNumber: string;
  readonly serviceFeePct: number;
}

const CLASS_LABEL: Record<string, string> = {
  go: "Go",
  comfort: "Comfort",
  xl: "XL",
  moto: "Moto",
};
const PAY_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  wallet: "UBI Wallet",
};

/** Facts the live Rides card may print. Each maps to one config field. Never fares. */
export function rideFacts(config: CityConfig): RideFacts {
  const classList = config.vehicleClasses.map((c) => CLASS_LABEL[c] ?? c);
  const payList = config.paymentMethods
    .filter((m) => m.available)
    .map((m) => PAY_LABEL[m.id] ?? m.id);
  const doors = config.airport.doors;
  const airportCodes = config.airport.codes.join("/");
  const airportDoors = [doors.international_arrivals, doors.domestic_arrivals]
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .join(" · ");
  return {
    classes: classList.join(" · "),
    classList,
    payWith: payList.join(" · "),
    payList,
    cashAccepted: config.paymentMethods.some(
      (m) => m.id === "cash" && m.available,
    ),
    pickup: `${config.pinRequired ? "PIN-verified" : "Verified"} · ${Math.round(
      config.waitPolicy.freeSec / 60,
    )} min free waiting`,
    airport:
      config.airport.codes.length > 0
        ? airportDoors
          ? `${airportCodes} · ${airportDoors}`
          : airportCodes
        : undefined,
    airportCodes,
    emergency: `${config.emergencyNumber} from inside the trip screen`,
    emergencyNumber: config.emergencyNumber,
    serviceFeePct: config.serviceFeePct,
  };
}

/** URL slug of a city name: "Port Harcourt" → "port-harcourt". */
export function citySlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical path of a city page (board: ubi.africa/cities/lagos). */
export function cityPath(city: { readonly name: string }): string {
  return `/cities/${citySlug(city.name)}`;
}

/**
 * Resolves a URL segment or `?city=` value to a row: the slug of the name
 * (`lagos`) or the id in any case (`LOS`, `los`). Unknown ⇒ undefined.
 */
export function findCityRow<
  T extends { readonly id: string; readonly name: string },
>(rows: readonly T[], param: string): T | undefined {
  const wanted = param.trim().toLowerCase();
  if (wanted === "") return undefined;
  return rows.find(
    (row) => citySlug(row.name) === wanted || row.id.toLowerCase() === wanted,
  );
}
