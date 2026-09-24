/**
 * Guard: the fleet portal never does money math (product invariant — money
 * is server-authoritative integer minor units; clients never compute it).
 *
 * Scans every source file of the app (tests excluded) with comments, string
 * literals and JSX text removed, and fails on arithmetic applied to a money
 * value (`amountMinor * …`, `… - gross`, `commission / …`), on a 10% literal
 * (a client-side commission), and on rounding a money value. The detector is
 * tested against known-bad and known-good snippets first, so the guard can't
 * pass vacuously.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

const MONEY_IDENT = String.raw`[\w$]*?(?:[Mm]inor|[Aa]mount|[Gg]ross|[Cc]ommission|[Rr]emittance|[Ff]are|[Pp]rice|[Mm]oney|[Nn]et[A-Z][\w$]*)[\w$]*`;
const ARITH_AFTER = new RegExp(
  String.raw`\b${MONEY_IDENT}\s*(?:\)\s*)?[*/%]|\b${MONEY_IDENT}\s*[+-](?![+-=>])`,
);
const ARITH_BEFORE = new RegExp(
  String.raw`[*/%]\s*\(?\s*\b${MONEY_IDENT}\b|[^+\-=!<>?:,(\[{&|\s]\s*[+-]\s*\b${MONEY_IDENT}\b`,
);
const TEN_PERCENT = /(?<![\w.])0?\.1(?![\d\w])|\b10\s*\/\s*100\b/;
const ROUNDING_MONEY = new RegExp(
  String.raw`(?:Math\.(?:round|floor|ceil|trunc)|parseFloat)\([^)]*${MONEY_IDENT}|${MONEY_IDENT}[^;\n]*\.toFixed\(`,
);

/** Source with comments, strings and (in TSX) JSX text blanked out. */
export function codeOnly(source: string, tsx: boolean): string {
  let code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^\\`])*`/g, (template) =>
      (template.match(/\$\{[^}]*\}/g) ?? []).join(" "),
    )
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    // Regex literals (after an operator, a bracket or at line start).
    .replace(
      /(^|[(,=:[!&|?{};]|return)(\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[dgimsuy]*/gm,
      "$1$2RE",
    );
  if (tsx) {
    code = code.replace(/>[^<>{}]*</g, "><");
  }
  return code;
}

export function moneyMathFindings(source: string, tsx = false): string[] {
  const findings: string[] = [];
  codeOnly(source, tsx)
    .split("\n")
    .forEach((line, index) => {
      if (ARITH_AFTER.test(line) || ARITH_BEFORE.test(line)) {
        findings.push(
          `${index + 1}: arithmetic on a money value: ${line.trim()}`,
        );
      }
      if (TEN_PERCENT.test(line)) {
        findings.push(`${index + 1}: a 10% literal: ${line.trim()}`);
      }
      if (ROUNDING_MONEY.test(line)) {
        findings.push(`${index + 1}: rounding a money value: ${line.trim()}`);
      }
    });
  return findings;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [full]
      : [];
  });
}

describe("money guard detector", () => {
  it.each([
    "const commission = fare.amountMinor * 0.1;",
    "const net = gross - commission;",
    "const total = money.amountMinor + fee;",
    "const cut = amountMinor / 10;",
    "const x = 2 * remittanceMinor;",
    "const pct = Math.round(weekGross.amountMinor);",
    "const shown = (terms.amountMinor / 100).toFixed(2);",
    "const tax = price * rate;",
  ])("flags %s", (snippet) => {
    expect(moneyMathFindings(snippet).length).toBeGreaterThan(0);
  });

  it.each([
    "const text = formatMinor(terms.amountMinor, terms.currency);",
    "const minor = parseMajorToMinor(form.amount, fleet.currency);",
    "if (amountMinor === null || money.available !== true) { return; }",
    'const label = "Week gross / UBI commission - remittance * status";',
    "const width = (value / rangeHours) * 100;",
    "const next = focus.block + step;",
    "draftTerms.amountMinor ?? undefined",
  ])("does not flag %s", (snippet) => {
    expect(moneyMathFindings(snippet)).toEqual([]);
  });

  it("ignores regex literals but not division", () => {
    expect(moneyMathFindings("const patterns = [/fare/i, /price/i];")).toEqual(
      [],
    );
    expect(
      moneyMathFindings("const x = amountMinor / 100;").length,
    ).toBeGreaterThan(0);
  });

  it("ignores JSX text but not JSX expressions", () => {
    expect(
      moneyMathFindings("<dt>Week gross - UBI commission</dt>", true),
    ).toEqual([]);
    expect(
      moneyMathFindings("<dd>{gross - commission}</dd>", true).length,
    ).toBeGreaterThan(0);
  });
});

describe("the fleet portal source", () => {
  const files = sourceFiles(SRC);

  it("scans the portal's screens and libraries", () => {
    const names = files.map((file) => path.relative(SRC, file));
    expect(names).toContain(path.join("lib", "money.ts"));
    expect(names).toContain(
      path.join("components", "vehicle", "VehicleDetail.tsx"),
    );
    expect(names).toContain(
      path.join("components", "assignments", "Assignments.tsx"),
    );
    expect(files.length).toBeGreaterThan(30);
  });

  it("does no arithmetic on money, anywhere", () => {
    const findings = files.flatMap((file) =>
      moneyMathFindings(readFileSync(file, "utf8"), file.endsWith(".tsx")).map(
        (finding) => `${path.relative(SRC, file)}:${finding}`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it("has no major-unit currency formatter (the mock-era formatCurrency)", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /function formatCurrency|formatCurrency\(/,
      );
    }
  });
});
