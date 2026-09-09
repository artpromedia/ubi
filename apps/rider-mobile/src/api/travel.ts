import { api, type Money } from '@ubi/mobile-core';
export type Capabilities = { holdSupported: boolean; priceGuaranteeUntil?: string; merchantOfRecord: 'ubi' | 'supplier'; changeSupported: boolean; refundSupported: boolean; currency: string; payAtProperty?: boolean };
export type FareFamily = { id: string; name: string; price: Money; base?: Money; taxes?: Money; baggage: string; changeRule: string; refundRule: string; protectionOffered?: boolean; seatsLeft?: number };
export type FlightOffer = { offerRef: string; carrier: string; flightNumber: string; aircraft?: string; departAt: string; arriveAt: string; departTerminal?: string; arriveTerminal?: string; durationMin: number; stops: number; soldOut?: boolean; soldOutNote?: string; fareFamilies: FareFamily[]; capabilities: Capabilities };
export type FlightSearch = { searchId: string; pricesAsOf: string; from: string; to: string; date: string; passengers: number; offers: FlightOffer[] };
export type Rate = { id: string; roomName: string; board?: string; occupancy: { minAdults: number; maxAdults: number; bookable: boolean; reason?: string }; payNow: Money; payAtProperty: Money; supplierPrice?: Money; fx?: { rate: number; lockedUntil: string }; taxesNote?: string; cancellation: { freeUntil: string; penaltyAfter: string }; capabilities: Capabilities; approximate?: boolean };
export type Property = { id: string; name: string; area: string; distanceKm: number; distanceTo: string; checkIn: string; checkOut: string; nights: number };
export type CartItem = { kind: 'flight' | 'stay'; title: string; detail: string; price: Money; previousPrice?: Money; terms: string[] };
export type Cart = { id: string; status: 'building' | 'priced' | 'repriced' | 'paying' | 'checked_out' | 'expired'; items: CartItem[]; fees: { label: string; amount: Money }[]; adjustments: { label: string; amount?: Money; note?: string }[]; total: Money; previousTotal?: Money; paymentMethod: { id: string; label: string; detail: string }; termsSummary: string[]; termsLinks: string[] };
export type LadderStepDto = { step: string; label: string; state: 'done' | 'active' | 'pending' | 'skipped'; at?: string; detail?: string };
export type OrderState = 'payment_authorized' | 'submitted' | 'supplier_pending' | 'confirmed' | 'ticketed' | 'failed_released' | 'unknown_reconciling' | 'disrupted' | 'cancelled' | 'refunded' | 'completed';
export type Order = { id: string; tripId: string; kind: 'flight' | 'stay'; title: string; state: OrderState; headline: string; body: string; ladder: LadderStepDto[]; supplierRefs: { pnr?: string; ticketNumbers?: string[]; bookingRef?: string; orderRef?: string }; price: Money; held?: Money; charged?: Money; released?: Money; policy: { cancellation: string; change?: string; freeUntil?: string }; siblingNote?: string };
export type Refund = { id: string; orderId: string; amount: Money; stage: 'requested' | 'supplier_confirmed' | 'supplier_refund_pending' | 'refunded_to_wallet' | 'rejected'; expectedBy?: string; penalty?: Money; headline: string; body: string; steps: LadderStepDto[]; footnote?: string };
export type Alternative = { id: string; carrier: string; flightNumber: string; departAt: string; arriveAt: string; fareFamily?: string; baggage?: string; seatsLeft?: number; price: Money; covered?: Money; customerPays: Money; heldUntil?: string; note?: string };
export type Disruption = { cause: 'airline_cancelled' | 'schedule_change' | 'delay_major'; verifiedAt: string; headline: string; body: string; eligibility: { covered: boolean; ruleId?: string; fundedBy?: string; cap?: Money; title: string; text: string }; airlineOptions: Alternative[]; alternatives: Alternative[]; refund: { amount: Money; path: string; etaDays: string; title: string }; linkedRideImpact?: string; footnote?: string };
export type LinkedItem = { kind: 'flight' | 'stay' | 'ride_reservation' | 'return_flight_placeholder'; orderId?: string; reservationId?: string; title: string; subtitle?: string; dateLabel: string; status: 'ticketed' | 'confirmed' | 'supplier_pending' | 'not_reserved' | 'reserved' | 'assigned' | 'completed' | 'cancelled' | 'refunded' | 'not_booked'; charged?: Money; policy?: string; disruption?: string; refs?: string; actions: { key: string; label: string; primary?: boolean }[] };
export type Trip = { id: string; title: string; dates: string; timezone: string; items: LinkedItem[] };
export type ReservationSuggestion = { flightLabel: string; advice: string; suggestedPickupAt: string; options: string[]; from: string; classes: { id: string; label: string; price: Money }[]; terms: string; mapLabel: string };

export const travelApi = {
  searchFlights: (params: { from: string; to: string; departDate: string; returnDate?: string; passengers: number; cabin?: string }) => api<FlightSearch>('POST', '/v1/travel/flights/searches', params),
  refreshFlights: (searchId: string) => api<FlightSearch>('GET', '/v1/travel/flights/searches/' + searchId),
  rates: (propertyId: string, searchId: string) => api<{ property: Property; rates: Rate[] }>('GET', '/v1/travel/stays/' + propertyId + '/rates?searchId=' + searchId),
  createCart: (items: { kind: 'flight' | 'stay'; offerRef: string; fareFamilyId?: string; rateId?: string }[]) => api<Cart>('POST', '/v1/travel/carts', { items }),
  cart: (cartId: string) => api<Cart>('GET', '/v1/travel/carts/' + cartId),
  putPassengers: (cartId: string, passengers: unknown[]) => api<void>('PUT', '/v1/travel/carts/' + cartId + '/passengers', passengers),
  checkout: (cartId: string, paymentMethodId: string, proof: string, expectedTotal: Money) => api<{ tripId: string; orders: Order[] }>('POST', '/v1/travel/carts/' + cartId + '/checkout', { paymentMethodId, assurance: { method: 'pin', proof }, expectedTotal }),
  order: (orderId: string) => api<Order>('GET', '/v1/travel/orders/' + orderId),
  trip: (tripId: string) => api<Trip>('GET', '/v1/travel/trips/' + tripId),
  linked: (tripId: string) => api<Trip>('GET', '/v1/travel/trips/' + tripId + '/linked'),
  refund: (refundId: string) => api<Refund>('GET', '/v1/travel/refunds/' + refundId),
  disruption: (orderId: string) => api<Disruption>('GET', '/v1/travel/orders/' + orderId + '/disruption'),
  switchTo: (orderId: string, alternativeId: string) => api<Order>('POST', '/v1/travel/orders/' + orderId + '/switch', { alternativeId }),
  requestRefund: (orderId: string) => api<Refund>('POST', '/v1/travel/orders/' + orderId + '/cancel'),
  reservationSuggestion: (orderId: string, direction: string) => api<ReservationSuggestion>('GET', '/v1/reservations/suggest?linkedOrderId=' + orderId + '&direction=' + direction),
  reserve: (orderId: string, pickupAt: string, classId: string) => api<{ reservationId: string; status: 'reserved' | 'reservation_failed'; reason?: string }>('POST', '/v1/reservations', { linkedOrderId: orderId, pickupAt, classId }),
};
