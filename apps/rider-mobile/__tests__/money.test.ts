import { formatMinor, accessibleMoney, bpsToPercent } from '@ubi/mobile-core';
import { formatMoney, money } from '@ubi/contracts';

describe('@ubi/mobile-core money formatter (kobo -> NGN)', () => {
  it('formats whole naira with grouping and no kobo', () => {
    expect(formatMinor({ amountMinor: 150000, currency: 'NGN' })).toBe('₦1,500');
    expect(formatMinor({ amountMinor: 123456700, currency: 'NGN' })).toBe('₦1,234,567');
    expect(formatMinor({ amountMinor: 0, currency: 'NGN' })).toBe('₦0');
  });

  it('shows kobo only when the minor part is non-zero', () => {
    expect(formatMinor({ amountMinor: 150050, currency: 'NGN' })).toBe('₦1,500.50');
    expect(formatMinor({ amountMinor: 99, currency: 'NGN' })).toBe('₦0.99');
  });

  it('renders an em dash for missing money', () => {
    expect(formatMinor(undefined)).toBe('—');
    expect(formatMinor(null)).toBe('—');
  });

  it('uses a true minus for negatives and an optional plus when signed', () => {
    expect(formatMinor({ amountMinor: -50000, currency: 'NGN' })).toBe('−₦500');
    expect(formatMinor({ amountMinor: 50000, currency: 'NGN' }, {}, { signed: true })).toBe('+₦500');
  });

  it('announces an accessible amount with its currency name', () => {
    expect(accessibleMoney({ amountMinor: 150000, currency: 'NGN' })).toBe('1,500 naira');
    expect(accessibleMoney(undefined)).toBe('amount unavailable');
  });

  it('formats basis points as a percentage', () => {
    expect(bpsToPercent(2000)).toBe('20%');
    expect(bpsToPercent(1550)).toBe('15.5%');
  });
});

describe('parity with @ubi/contracts formatMoney (the money source of truth)', () => {
  // mobile-core drops a whole-naira ".00"; contracts (fractionDigits=2) keeps it.
  // Normalise that one difference, then the grouped amount must be identical.
  const stripWholeKobo = (s: string) => s.replace(/\.00$/, '');
  const cases = [150000, 123456700, 150050, 99, 0];

  it.each(cases)('agrees on %d kobo', (minor) => {
    const core = formatMinor({ amountMinor: minor, currency: 'NGN' });
    const contract = formatMoney(money(minor, 'NGN'), { locale: 'en-NG', fractionDigits: 2 });
    expect(stripWholeKobo(contract)).toBe(core);
  });
});
