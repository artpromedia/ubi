import type { NavigatorScreenParams } from '@react-navigation/native';
export type AuthStackParamList = { Login: undefined; Register: undefined; Otp: { phone: string } };
export type TripStackParamList = { Offer: { requestId: string }; Navigate: { tripId: string }; Waiting: { tripId: string }; Pin: { tripId: string }; InTrip: { tripId: string }; Cash: { tripId: string }; Complete: { tripId: string } };
export type EarningsStackParamList = { Overview: undefined; Statement: { periodId: string }; TripDetail: { tripId: string }; Payouts: undefined; Cashout: undefined };
export type IncentivesStackParamList = { Overview: undefined; CommissionDetail: { incentiveId: string }; Referrals: undefined; Window: { windowId: string } };
export type AccountStackParamList = { Profile: undefined; Edit: undefined; Vehicle: undefined; Documents: undefined; UploadDocument: { documentType: string }; Ratings: undefined; Settings: undefined; FleetArrangement: undefined; LivenessCheck: undefined; Ask: undefined };
export type MainTabParamList = { Home: undefined; Earnings: NavigatorScreenParams<EarningsStackParamList>; Incentives: NavigatorScreenParams<IncentivesStackParamList>; Account: NavigatorScreenParams<AccountStackParamList> };
export type RootStackParamList = { Splash: undefined; Onboarding: undefined; Auth: NavigatorScreenParams<AuthStackParamList>; Main: NavigatorScreenParams<MainTabParamList>; Trip: NavigatorScreenParams<TripStackParamList>; Sos: { tripId?: string } | undefined; FlagOff: { feature: string }; SecureConfirm: { purpose: string; onProof: (proof: string) => void } };
declare global { namespace ReactNavigation { interface RootParamList extends RootStackParamList {} } }
