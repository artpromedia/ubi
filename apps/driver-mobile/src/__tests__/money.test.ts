import { formatMinor, bpsToPercent, accessibleMoney } from '@ubi/mobile-core';

const NGN = (amountMinor: number) => ({ amountMinor, currency: 'NGN' });
const MINUS = '−'; // U+2212, the formatter's negative sign (not an ASCII hyphen)

describe('money formatter (@ubi/mobile-core)', () => {
  describe('formatMinor', () => {
    it('renders whole naira with grouping and no decimals by default', () => {
      expect(formatMinor(NGN(465_000))).toBe('₦4,650');
      expect(formatMinor(NGN(2_923_000))).toBe('₦29,230');
    });

    it('shows kobo only when the minor part is non-zero', () => {
      expect(formatMinor(NGN(155))).toBe('₦1.55');
      expect(formatMinor(NGN(100))).toBe('₦1');
    });

    it('renders negatives with the U+2212 minus sign, never a hyphen', () => {
      const out = formatMinor(NGN(-30_380));
      expect(out).toBe(MINUS + '₦303.80');
      expect(out.startsWith(MINUS)).toBe(true);
      expect(out).not.toContain('-');
    });

    it('prefixes a + only when signed and positive', () => {
      expect(formatMinor(NGN(4_810), {}, { signed: true })).toBe('+₦48.10');
      // signed has no effect on negatives — the minus already carries the sign
      expect(formatMinor(NGN(-4_810), {}, { signed: true })).toBe(MINUS + '₦48.10');
    });

    it('honours city-config format overrides (symbol, digits, locale)', () => {
      expect(formatMinor(NGN(465_000), { minorDigitsShown: 2 })).toBe('₦4,650.00');
      expect(formatMinor({ amountMinor: 100, currency: 'USD' }, { currencySymbol: '$', locale: 'en-US' })).toBe('$1');
    });

    it('returns an em dash for a missing amount', () => {
      expect(formatMinor(undefined)).toBe('—');
      expect(formatMinor(null)).toBe('—');
    });
  });

  describe('bpsToPercent', () => {
    it('formats whole-number percents without decimals', () => {
      expect(bpsToPercent(2000)).toBe('20%'); // base commission
      expect(bpsToPercent(1500)).toBe('15%'); // effective after a 5pt rebate
      expect(bpsToPercent(500)).toBe('5%');
    });
    it('keeps one decimal for fractional percents', () => {
      expect(bpsToPercent(1250)).toBe('12.5%');
    });
  });

  describe('accessibleMoney', () => {
    it('announces the currency name for screen readers', () => {
      expect(accessibleMoney(NGN(465_000))).toBe('4,650 naira');
      expect(accessibleMoney(NGN(-155))).toBe('minus 1 naira');
    });
    it('degrades gracefully when there is no amount', () => {
      expect(accessibleMoney(undefined)).toBe('amount unavailable');
    });
  });
});
