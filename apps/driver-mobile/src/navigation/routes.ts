import type { NavigatorScreenParams } from "@react-navigation/native";
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  Otp: { phone: string };
};
// Every screen carries the ride id (`tripId` — the marketplace award's
// executionRef.id, per the jobs surface). "Offer" is the one-time "you won
// this job" landing screen from JobsTimelineContainer; nothing server-side
// distinguishes it from Navigate — both read the same ride view — so it is a
// purely local first stop before the driver taps through to navigation.
export type TripStackParamList = {
  Offer: { tripId: string };
  Navigate: { tripId: string };
  Waiting: { tripId: string };
  Pin: { tripId: string };
  InTrip: { tripId: string };
  Cash: { tripId: string };
  Complete: { tripId: string };
};
export type EarningsStackParamList = {
  Overview: undefined;
  Statement: { periodId: string };
  TripDetail: { tripId: string };
  Payouts: undefined;
  Cashout: undefined;
};
export type IncentivesStackParamList = {
  Overview: undefined;
  CommissionDetail: { incentiveId: string };
  Referrals: undefined;
  Window: { windowId: string };
};
export type AccountStackParamList = {
  Profile: undefined;
  Edit: undefined;
  Vehicle: undefined;
  Documents: undefined;
  UploadDocument: { documentType: string };
  Ratings: undefined;
  Settings: undefined;
  FleetArrangement: undefined;
  LivenessCheck: undefined;
  Ask: undefined;
};
// Negotiated-fare marketplace (M08, boards D01–D12). Detail carries only the server id;
// WalletHolds params are serializable server-phrased strings (the exact insufficient_spendable
// shortfall message) plus a returnTo so the driver lands back on the still-open request (D04).
export type RequestsStackParamList = {
  Feed: undefined;
  Detail: { requestId: string };
};
export type WalletHoldsParams =
  | {
      shortfall?: { title: string; detail: string };
      returnTo?: { requestId: string; label: string };
    }
  | undefined;
export type MainTabParamList = {
  Home: undefined;
  Requests: NavigatorScreenParams<RequestsStackParamList>;
  Earnings: NavigatorScreenParams<EarningsStackParamList>;
  Incentives: NavigatorScreenParams<IncentivesStackParamList>;
  Account: NavigatorScreenParams<AccountStackParamList>;
};
export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  Trip: NavigatorScreenParams<TripStackParamList>;
  WalletHolds: WalletHoldsParams;
  Rates: undefined;
  // A04.2 driver preferences (filters/suggestions only — never bidding).
  Preferences: undefined;
  Jobs: undefined;
  // A02: the executing marketplace trip (stops, waiting, early termination) and its
  // post-award route amendments — both keyed by the marketplace request id.
  MpTrip: { requestId: string };
  MpAmendments: { requestId: string };
  // A03: the driver's booking calendar (future bookings, not the live slots).
  Calendar: undefined;
  // A05 fleet calendar (handoff C1–C5), each behind the deny-by-default `fleet`
  // flag: the schedule, a fleet's proposal (PIN signing), a booking conflict
  // (keep on a swapped vehicle / withdraw), time off, and a vehicle problem.
  FleetSchedule: undefined;
  FleetProposal: { offerId?: string } | undefined;
  FleetConflict: { conflictId: string };
  FleetAvailability: undefined;
  FleetReportIssue: { vehicleId?: string } | undefined;
  Sos: { tripId?: string } | undefined;
  FlagOff: { feature: string };
  SecureConfirm: { purpose: string; onProof: (proof: string) => void };
};
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- react-navigation's documented global-typing pattern
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the extends clause is the whole point
    interface RootParamList extends RootStackParamList {}
  }
}
