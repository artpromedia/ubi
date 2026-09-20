// R02 + R03 container — Marketplace.Fare. The server owns bounds and validation: the quote
// envelope is rendered verbatim, the typed amount is only packaged (major digits → minor units,
// quote currency) and every rejection (fare_out_of_bounds, market_not_configured) is shown
// with the server's own message. Publish → Offers with the server's requestId.
import React, { useEffect, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen, Banner, Button, Skeleton } from '@ubi/mobile-ui';
import { ApiError, formatMinor, track, type Money } from '@ubi/mobile-core';
import type { MarketplaceStackParamList } from '../../navigation/routes';
import { marketplaceApi } from '../../api/marketplace';
import { FareEditorScreen } from './FareEditorScreen';

const majorToMoney = (raw: string, currency: string): Money => ({ amountMinor: (parseInt(raw.replace(/\D/g, ''), 10) || 0) * 100, currency });

export function FareEditorContainer() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, 'Fare'>>();
  const qp = params.quoteParams;
  const q = useQuery({
    queryKey: ['mp', 'quote', qp],
    queryFn: () => marketplaceApi.quote({ service: qp.service, vehicleClass: qp.vehicleClass, pickupLat: qp.pickup.lat, pickupLng: qp.pickup.lng, dropoffLat: qp.dropoff.lat, dropoffLng: qp.dropoff.lng, weightKg: qp.weightKg }),
    retry: false, staleTime: 0,
  });
  const quote = q.data;
  const [expired, setExpired] = useState(false);
  const [amountRaw, setAmountRaw] = useState('');
  const [amount, setAmount] = useState<Money | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  // Seed the editable amount from the server suggestion once per quote.
  useEffect(() => {
    if (!quote) return;
    setExpired(false); setFieldError(null);
    setAmountRaw(String(Math.round(quote.suggestedFareMinor.amountMinor / 100)));
    setAmount(quote.suggestedFareMinor);
    const ms = Date.parse(quote.expiresAt) - Date.now();
    const timer = setTimeout(() => setExpired(true), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [quote?.quoteId]);
  const publish = useMutation({
    mutationFn: () => marketplaceApi.publish({
      quoteId: quote!.quoteId,
      requestedFareMinor: amount ?? quote!.suggestedFareMinor,
      paymentMethodId: 'pm_wallet',
      ...(qp.service === 'delivery' && qp.weightKg !== undefined ? { delivery: { weightKg: qp.weightKg, handling: qp.handling ?? [] } } : {}),
    }),
    onSuccess: (r) => { track('mp_request_published', { requestId: r.requestId, service: r.service }); setReviewVisible(false); nav.navigate('Offers', { requestId: r.requestId }); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'fare_out_of_bounds') { setFieldError(e.message); setReviewVisible(false); }
      if (e instanceof ApiError && e.code === 'quote_expired') { setExpired(true); setReviewVisible(false); }
    },
  });
  if (q.isError) {
    const notConfigured = q.error instanceof ApiError && q.error.code === 'market_not_configured';
    return (
      <Screen title="Set your fare" onBack={nav.goBack}>
        <Banner tone={notConfigured ? 'neutral' : 'error'} title={notConfigured ? 'Not available here yet' : 'Couldn’t price this trip'} body={notConfigured ? 'The fare marketplace isn’t configured for this route yet.' : (q.error as Error).message} />
        <Button label="Back" kind="secondary" onPress={nav.goBack} />
      </Screen>
    );
  }
  if (!quote) return <Screen title="Set your fare" onBack={nav.goBack}><Skeleton height={220} /><Skeleton height={120} /></Screen>;
  const publishError = publish.isError && !fieldError && !(publish.error instanceof ApiError && publish.error.code === 'quote_expired') ? (publish.error as Error).message : null;
  const belowSuggestion = amount !== null && amount.amountMinor < quote.suggestedFareMinor.amountMinor;
  return (
    <FareEditorScreen
      quote={quote}
      quoteState={expired ? 'expired' : 'live'}
      amountRaw={amountRaw}
      amountMinor={amount ?? quote.suggestedFareMinor}
      onAmountChange={(raw) => { const digits = raw.replace(/\D/g, ''); setAmountRaw(digits); setAmount(majorToMoney(digits, quote.currency)); setFieldError(null); }}
      fieldError={fieldError}
      belowSuggestionHint={belowSuggestion ? 'Below the suggestion — fewer drivers usually answer.' : null}
      presets={[{ label: 'Suggested · ' + formatMinor(quote.suggestedFareMinor), amountMinor: quote.suggestedFareMinor }]}
      onPresetSelect={(m) => { setAmountRaw(String(Math.round(m.amountMinor / 100))); setAmount(m); setFieldError(null); }}
      onRefreshQuote={() => { void q.refetch(); }}
      onReview={() => { publish.reset(); setReviewVisible(true); }}
      onBack={nav.goBack}
      review={{
        visible: reviewVisible,
        payment: 'UBI Wallet',
        cancellation: 'Free to cancel until you choose an offer',
        publishing: publish.isPending,
        publishError,
        onSend: () => publish.mutate(),
        onEdit: () => setReviewVisible(false),
        onDismiss: () => setReviewVisible(false),
      }}
    />
  );
}
