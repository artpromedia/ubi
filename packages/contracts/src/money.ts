/**
 * Money is always integer minor units plus an explicit currency.
 *
 * CLAUDE.md non-negotiable #1: clients render money, they never compute it, and
 * the currency always comes from city config — never an NGN literal in code.
 */
import { z } from "zod";

/** ISO-4217 alphabetic code. Validated shape only; the allowed set is city config. */
export const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "currency must be an ISO-4217 alpha-3 code");

export const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: CurrencySchema,
});

export type Money = z.infer<typeof MoneySchema>;

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`currency mismatch: ${left} vs ${right}`);
    this.name = "CurrencyMismatchError";
  }
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      `amountMinor must be an integer, received ${amountMinor}`,
    );
  }
  return { amountMinor, currency };
}

export const zero = (currency: string): Money => money(0, currency);

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negateMoney(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

export function sumMoney(values: readonly Money[], currency: string): Money {
  return values.reduce<Money>(
    (acc, value) => addMoney(acc, value),
    zero(currency),
  );
}

export function compareMoney(a: Money, b: Money): number {
  sameCurrency(a, b);
  return a.amountMinor === b.amountMinor
    ? 0
    : a.amountMinor < b.amountMinor
      ? -1
      : 1;
}

/**
 * Percentage of a money amount in minor units.
 *
 * Rounds half away from zero so a 20% service fee on ₦3,100.50 does not silently
 * lose or gain a kobo depending on the sign. The remainder is returned so callers
 * posting a double-entry journal can allocate it explicitly instead of dropping it.
 */
export function splitPercent(
  amount: Money,
  percent: number,
): { readonly part: Money; readonly remainder: Money } {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(
      `percent must be within [0, 100], received ${percent}`,
    );
  }
  const exact = (amount.amountMinor * percent) / 100;
  const rounded = exact < 0 ? -Math.round(-exact) : Math.round(exact);
  return {
    part: money(rounded, amount.currency),
    remainder: money(amount.amountMinor - rounded, amount.currency),
  };
}

/**
 * Renders minor units for display. `fractionDigits` comes from city config
 * (kobo = 2); callers must not assume 2 for every market.
 */
export function formatMoney(
  value: Money,
  options: { readonly locale: string; readonly fractionDigits: number },
): string {
  const { locale, fractionDigits } = options;
  const divisor = 10 ** fractionDigits;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value.amountMinor / divisor);
}

/**
 * Accessible label for screen readers — CLAUDE.md requires money to be
 * announced with its currency rather than read as a bare number.
 */
export function moneyAccessibilityLabel(
  value: Money,
  options: { readonly locale: string; readonly fractionDigits: number },
): string {
  const divisor = 10 ** options.fractionDigits;
  const amount = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits: options.fractionDigits,
    maximumFractionDigits: options.fractionDigits,
  }).format(value.amountMinor / divisor);
  return `${amount} ${value.currency}`;
}
