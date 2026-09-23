// The no-client-math rule (launch CLAUDE.md #1, A04.1), checked on the source: the
// screens and containers that render offer earnings and preferences never put a money
// field into arithmetic. Money reaches them as server Money objects and leaves through
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
];

describe("no client money math", () => {
  it.each(RENDER_FILES)("%s does no arithmetic on money fields", (file) => {
    const source = read(file);
    for (const pattern of MONEY_ARITHMETIC) {
      const hit = source.match(pattern);
      expect(hit ? hit[0] : null).toBeNull();
    }
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
