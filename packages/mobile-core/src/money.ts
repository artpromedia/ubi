// Formatting only. Money is never computed on the client (launch CLAUDE.md #1).
import type { Money } from './api';
export type MoneyFormat = { currencySymbol: string; minorDigitsShown: number; locale: string };
const DEFAULT: MoneyFormat = { currencySymbol: '₦', minorDigitsShown: 0, locale: 'en-NG' };

export function formatMinor(m: Money | undefined | null, fmt: Partial<MoneyFormat> = {}, opts: { signed?: boolean } = {}): string {
  if (!m) return '—';
  const f = { ...DEFAULT, ...fmt };
  const negative = m.amountMinor < 0;
  const abs = Math.abs(m.amountMinor);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const grouped = major.toLocaleString(f.locale);
  const digits = f.minorDigitsShown > 0 || minor !== 0 ? '.' + String(minor).padStart(2, '0') : '';
  const sign = negative ? '−' : opts.signed ? '+' : '';
  return sign + f.currencySymbol + grouped + digits;
}
export function bpsToPercent(bps: number): string { const v = bps / 100; return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + '%'; }
export function accessibleMoney(m: Money | undefined, currencyName = 'naira'): string {
  if (!m) return 'amount unavailable';
  const major = Math.floor(Math.abs(m.amountMinor) / 100);
  return (m.amountMinor < 0 ? 'minus ' : '') + major.toLocaleString('en-NG') + ' ' + currencyName;
}
