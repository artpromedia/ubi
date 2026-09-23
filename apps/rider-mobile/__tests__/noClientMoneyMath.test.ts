// The no-client-money-math rule (launch CLAUDE.md #1), checked on the SOURCE of every
// A02/A03 rider screen, container and copy/format helper — and, since UI-rider-2, the A06
// offer comparison, booking options (saved driver, service needs, passenger, organization),
// saved drivers, receipt, passenger trip link and airport transfer screens: money reaches them
// as server Money objects and leaves only through MoneyText / formatMinor (formatting) or
// verbatim server labels. The single documented exception is lib/moneyInput.ts — packaging the
// digits a rider types into a Money value (the server validates it) — which is asserted
// to stay the only place that builds or scales an amount.
import { readFileSync } from "fs";
import { join } from "path";

const src = join(__dirname, "..", "src");
const read = (file: string) =>
  readFileSync(join(src, file), "utf8")
    // Comments may describe the server's arithmetic ("original + adjustments"); code may not.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// A money-named identifier (…Minor, or .amountMinor) directly in + − × ÷ % arithmetic.
const MONEY_ARITHMETIC = [
  /\b\w*Minor\b(?:\.amountMinor)?\)?\s*[-+*/%](?![=>])\s*[\w(]/,
  /[\w)]\s*[-+*/%]\s*\(?[\w.?!]*\.(?:amountMinor|\w+Minor)\b/,
];

const MP = "screens/marketplace/";
const TRAVEL = "screens/travel/";
const FILES = [
  MP + "RouteBuilderScreen.tsx",
  MP + "RouteBuilderContainer.tsx",
  MP + "PlacePickerSheet.tsx",
  MP + "TripScreen.tsx",
  MP + "TripContainer.tsx",
  MP + "ProposeChangeScreen.tsx",
  MP + "ProposeChangeContainer.tsx",
  MP + "ScheduleRideScreen.tsx",
  MP + "ScheduleRideContainer.tsx",
  MP + "LaterHub.tsx",
  MP + "ScheduledDetail.tsx",
  MP + "AdvanceOffers.tsx",
  MP + "BookingDetail.tsx",
  // A05 fleet calendar: the rider's D1/D2 moments.
  MP + "BookingFleetMoments.tsx",
  MP + "RecurringSeries.tsx",
  MP + "riderCopy.ts",
  MP + "riderParts.tsx",
  // A06 / A04.3 rider confidence (UI-rider-2).
  MP + "OfferInboxScreen.tsx",
  MP + "OfferInboxContainer.tsx",
  MP + "offerOrder.ts",
  MP + "offerView.ts",
  MP + "BidDetailScreen.tsx",
  MP + "BidDetailContainer.tsx",
  MP + "BookingOptions.tsx",
  MP + "BusinessParts.tsx",
  MP + "PassengerLinkCard.tsx",
  MP + "FavouriteDrivers.tsx",
  MP + "ReceiptScreen.tsx",
  MP + "confidenceCopy.ts",
  // Airport transfers (round-5/6 contract).
  TRAVEL + "AttachAirportRideScreen.tsx",
  TRAVEL + "TransferStatusScreen.tsx",
  TRAVEL + "transferCopy.ts",
  TRAVEL + "TravelCheckoutScreen.tsx",
  "components/travel/ItemCard.tsx",
  "api/marketplace.ts",
  "api/business.ts",
  "api/locations.ts",
  "api/travel.ts",
];
// Pure views: money is rendered ONLY through MoneyText (no formatting of their own).
const PRESENTATIONAL = [
  MP + "RouteBuilderScreen.tsx",
  MP + "TripScreen.tsx",
  MP + "ScheduleRideScreen.tsx",
  MP + "OfferInboxScreen.tsx",
  MP + "BidDetailScreen.tsx",
  MP + "ReceiptScreen.tsx",
  TRAVEL + "TransferStatusScreen.tsx",
];

describe("no client money math on the A02/A03 rider screens", () => {
  it.each(FILES)("%s does no arithmetic on money fields", (file) => {
    const source = read(file);
    for (const pattern of MONEY_ARITHMETIC) {
      const hit = source.match(pattern);
      expect(hit ? hit[0] : null).toBeNull();
    }
  });

  // api/marketplace.ts is checked for arithmetic above but not here: its pre-existing
  // delivery-custody mapper composes the server's own fee number into the Money shape
  // (composition, never arithmetic) — none of the A02/A03 paths do even that.
  // BidDetailContainer passes the server's own offer amount straight into its view's `bid`
  // prop (`amountMinor: offer.amountMinor` — composition of a server value, never arithmetic).
  it.each(
    FILES.filter(
      (f) => f !== "api/marketplace.ts" && f !== MP + "BidDetailContainer.tsx",
    ),
  )("%s never builds, scales or rounds a money value", (file) => {
    const source = read(file);
    // A client-built Money object (`{ amountMinor: … }`) would be a client amount; a
    // type annotation (`amountMinor: Money`) is not.
    expect(source).not.toMatch(/amountMinor\s*:(?!\s*Money\b)/);
    // No rounding / number coercion of a money field, and no minor-unit scaling.
    expect(source).not.toMatch(
      /(?:Math\.\w+|Number|parseInt|parseFloat)\([^)]*Minor\b|Minor\b[^;\n]*\.toFixed\(/,
    );
    expect(source).not.toMatch(/[*/]\s*100\b(?!_)/);
  });

  it.each(PRESENTATIONAL)("%s renders money only through MoneyText", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/formatMinor\(/);
    expect(source).toMatch(/<MoneyText/);
  });

  it("the only sign test on money lives in riderCopy.moneySign (it picks words, not figures)", () => {
    for (const file of FILES.filter((f) => !f.endsWith("riderCopy.ts")))
      expect(read(file)).not.toMatch(/\.amountMinor\s*[<>]=?/);
    expect(read(MP + "riderCopy.ts")).toMatch(
      /export const moneySign = \(m: Money \| null \| undefined\)/,
    );
  });

  it("the rider never sees the driver's commission or net on these screens", () => {
    for (const file of FILES.filter((f) => f.startsWith(MP)))
      expect(read(file)).not.toMatch(
        /commissionMinor|commissionDeltaMinor|driverNetDeltaMinor|netMinor/,
      );
  });

  it("typed amounts are packaged only by lib/moneyInput (and nothing there prices anything)", () => {
    const helper = read("lib/moneyInput.ts");
    expect(helper).toMatch(/export const typedMajorToMoney/);
    expect(helper).not.toMatch(/commission|fee|net|bound|discount|total/i);
    // The typed-input screens use the helper instead of converting on their own.
    for (const file of [
      MP + "ScheduleRideContainer.tsx",
      TRAVEL + "AttachAirportRideScreen.tsx",
      TRAVEL + "TransferStatusScreen.tsx",
    ]) {
      expect(read(file)).toMatch(/typedMajorToMoney\(/);
    }
  });

  it("offers are never ranked or compared on the client — the server sorts (?sort=)", () => {
    for (const file of [MP + "offerOrder.ts", MP + "OfferInboxContainer.tsx"])
      expect(read(file)).not.toMatch(/\.sort\(\s*\(a, b\)[^)]*Minor/);
    expect(read("api/marketplace.ts")).toMatch(
      /"\?sort=" \+ encodeURIComponent\(sort\)/,
    );
  });

  it("the airport transfer body is the strict intent: no pickup time, class id or client fare bound", () => {
    const travel = read("api/travel.ts");
    expect(travel).toMatch(
      /createTransfer: \(body: CreateAirportTransfer, idempotencyKey: string\)/,
    );
    const body = travel.slice(
      travel.indexOf("export type CreateAirportTransfer"),
      travel.indexOf("export type TransferStatus"),
    );
    expect(body).not.toMatch(/pickupAt|classId|cityId|minimum|maximum/);
  });

  it("request bodies the rider sends never carry a client-computed amount", () => {
    // Amendment, waiting, skip, terminate and rematch bodies carry no money at all;
    // create/approve/revise carry only a server figure or the packaged typed amount.
    const api = read("api/marketplace.ts");
    expect(api).toMatch(/proposeAmendment[\s\S]*?body: MpProposeAmendment/);
    expect(api).toMatch(/\{ capRevision \}/);
    expect(api).toMatch(
      /rematchBooking: \(id: string, idempotencyKey: string\)/,
    );
  });
});
