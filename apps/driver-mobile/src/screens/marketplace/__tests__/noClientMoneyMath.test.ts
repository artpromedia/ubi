// The no-client-math rule (launch CLAUDE.md #1, A04.1, A05), checked on the source: the
// screens and containers that render offer earnings, preferences and the fleet
// calendar (C1–C5) never put a money field into arithmetic. Money reaches them as server Money objects and leaves through
// MoneyText/formatMinor (formatting) or verbatim server labels. The one documented
// exception is the preferences input packaging (typed whole major units → minor units,
// the same helper RateProfileContainer uses), which is asserted to stay in its helpers.
import { readFileSync } from "fs";
import { join } from "path";

const dir = join(__dirname, "..");
const read = (file: string) =>
  readFileSync(join(dir, file), "utf8")
    // Comments may describe the server's arithmetic ("gross − commission"); code may not.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// A money-named identifier (…Minor, or .amountMinor) directly in + − × ÷ % arithmetic.
const MONEY_ARITHMETIC = [
  /\b\w*Minor\b(?:\.amountMinor)?\)?\s*[-+*/%](?![=>])\s*[\w(]/,
  /[\w)]\s*[-+*/%]\s*\(?[\w.?!]*\.(?:amountMinor|\w+Minor)\b/,
];

const RENDER_FILES = [
  "EarningsBreakdownCard.tsx",
  "RequestFeedScreen.tsx",
  "RequestFeedContainer.tsx",
  "RequestDetailScreen.tsx",
  "RequestDetailContainer.tsx",
  "DriverPreferencesScreen.tsx",
  "JobsTimelineScreen.tsx",
  "JobsTimelineContainer.tsx",
  "WalletHoldsScreen.tsx",
  "WalletHoldsContainer.tsx",
];

// A02/A03 screens (trip stops + waiting, route amendments, booking calendar) and their
// copy/format helpers. Every amount they show — agreed/original fare, adjustments,
// waiting fee, cap, revised total, commission delta, net change, rider funding, booking
// net — is a server Money object passed straight to MoneyText.
const A02_A03_FILES = [
  "TripStopsScreen.tsx",
  "TripStopsContainer.tsx",
  "RouteAmendmentScreen.tsx",
  "RouteAmendmentContainer.tsx",
  "DriverCalendarScreen.tsx",
  "DriverCalendarContainer.tsx",
  "TripParts.tsx",
  "tripCopy.ts",
];
const PRESENTATIONAL = [
  "TripStopsScreen.tsx",
  "RouteAmendmentScreen.tsx",
  "DriverCalendarScreen.tsx",
];

describe("no client money math", () => {
  it.each(RENDER_FILES)("%s does no arithmetic on money fields", (file) => {
    const source = read(file);
    for (const pattern of MONEY_ARITHMETIC) {
      const hit = source.match(pattern);
      expect(hit ? hit[0] : null).toBeNull();
    }
  });

  it.each(A02_A03_FILES)(
    "%s does no arithmetic on money fields and never builds a Money value",
    (file) => {
      const source = read(file);
      for (const pattern of MONEY_ARITHMETIC) {
        const hit = source.match(pattern);
        expect(hit ? hit[0] : null).toBeNull();
      }
      // A client-built Money object (`{ amountMinor: … }`) would be a client amount.
      expect(source).not.toMatch(/amountMinor\s*:/);
      // No rounding/scaling of a money field either.
      expect(source).not.toMatch(
        /(?:Math\.\w+|Number|parseInt|parseFloat)\([^)]*Minor\b|Minor\b[^;\n]*\.toFixed\(/,
      );
    },
  );

  it.each(PRESENTATIONAL)(
    "%s renders money only through MoneyText (server Money in, no formatting of its own)",
    (file) => {
      const source = read(file);
      expect(source).not.toMatch(/formatMinor\(/);
      expect(source).toMatch(/<MoneyText/);
    },
  );

  it("the only sign test on money lives in tripCopy.moneySign (it picks words, not figures)", () => {
    for (const file of A02_A03_FILES.filter((f) => f !== "tripCopy.ts")) {
      expect(read(file)).not.toMatch(/\.amountMinor\s*[<>]=?/);
    }
    expect(read("tripCopy.ts")).toMatch(
      /export const moneySign = \(m: Money \| null \| undefined\)/,
    );
  });

  // A05 fleet driver screens (C1–C5), their shared parts and copy helpers. Every amount
  // — a proposal's weekly remittance, the commission a withdrawal returns — is a server
  // Money object passed straight to MoneyText. The one Money reshaping (a signed terms
  // snapshot's amount + currency, paired for MoneyText) lives in api/fleet.ts.
  const FLEET_DIR = join(__dirname, "..", "..", "fleet");
  const readFleet = (file: string) =>
    readFileSync(join(FLEET_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const FLEET_FILES = [
    "FleetScheduleScreen.tsx",
    "FleetProposalScreen.tsx",
    "FleetConflictScreen.tsx",
    "FleetAvailabilityScreen.tsx",
    "FleetReportIssueScreen.tsx",
    "FleetParts.tsx",
    "fleetCopy.ts",
  ];
  const FLEET_MONEY_SCREENS = [
    "FleetProposalScreen.tsx",
    "FleetConflictScreen.tsx",
    "FleetAvailabilityScreen.tsx",
  ];
  // Fleet money names that don't end in …Minor.
  const FLEET_MONEY_ARITHMETIC =
    /\b(?:commissionReturned|commissionMinor|weekly|remittance|money)\b\)?\s*[-+*/%](?![=>])\s*[\w(]/i;

  it.each(FLEET_FILES)(
    "fleet %s does no arithmetic on money, never builds, formats or reads a Money amount",
    (file) => {
      const source = readFleet(file);
      for (const pattern of [...MONEY_ARITHMETIC, FLEET_MONEY_ARITHMETIC]) {
        const hit = source.match(pattern);
        expect(hit ? hit[0] : null).toBeNull();
      }
      expect(source).not.toMatch(/amountMinor/);
      expect(source).not.toMatch(/formatMinor\(/);
      expect(source).not.toMatch(
        /(?:Math\.\w+|Number|parseInt|parseFloat)\([^)]*(?:Minor|commission|remittance)\b/i,
      );
    },
  );

  it.each(FLEET_MONEY_SCREENS)(
    "fleet %s renders money only through MoneyText",
    (file) => {
      expect(readFleet(file)).toMatch(/<MoneyText/);
    },
  );

  it("the fleet API's only Money value pairs two server fields, with no arithmetic", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "api", "fleet.ts"),
      "utf8",
    );
    const helper = source.match(/export const remittanceOf = [\s\S]*?;\n/)?.[0];
    expect(helper).toBeDefined();
    expect(helper).toMatch(
      /\{ amountMinor: terms\.amountMinor, currency: terms\.currency \}/,
    );
    expect(helper).not.toMatch(/[-+*/%]\s*\d|Math\.|toFixed/);
    expect(source.replace(helper ?? "", "")).not.toMatch(/amountMinor\s*:/);
  });

  it("the preferences container converts typed input only inside its packaging helpers", () => {
    const source = read("DriverPreferencesContainer.tsx");
    const withoutHelpers = source
      .replace(/const majorDigits = [^\n]*\n/, "")
      .replace(/const toMinor = [^\n]*\n/, "");
    for (const pattern of MONEY_ARITHMETIC) {
      const hit = withoutHelpers.match(pattern);
      expect(hit ? hit[0] : null).toBeNull();
    }
    // …and those helpers never touch a fee, net or rate.
    expect(source).not.toMatch(/commission|estimatedNet|netMinor|perHour/i);
  });
});
