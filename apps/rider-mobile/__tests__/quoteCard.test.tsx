import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import { QuoteCard } from '../src/components/ask/QuoteCard';
import type { Card } from '../src/api/ask';

const liveCard: Card = {
  id: 'card_1',
  kind: 'flight',
  status: 'live',
  quotedAt: new Date().toISOString(),
  title: 'Lagos → Abuja · Air Peace P47123',
  subtitle: 'Live price · Saver fare',
  price: { amountMinor: 8500000, currency: 'NGN' },
  warnings: ['1 seat left at this price'],
};

// Board 20a: the LIVE PRICE card. A screen-level smoke test that the card mounts
// with the status word, the adapter warning and server money (₦85,000) rendered.
describe('QuoteCard (live price) render smoke', () => {
  it('renders the card with title, warning and formatted money', () => {
    render(
      <ThemeProvider defaultMode="light">
        <QuoteCard card={liveCard} />
      </ThemeProvider>,
    );

    expect(screen.getByTestId(TID.ask.plan.card)).toBeTruthy();
    expect(screen.getByText('Lagos → Abuja · Air Peace P47123')).toBeTruthy();
    expect(screen.getByText('1 seat left at this price')).toBeTruthy();
    expect(screen.getByText('₦85,000')).toBeTruthy();
  });
});
