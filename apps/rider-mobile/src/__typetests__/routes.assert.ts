// Compile-time test for the typed navigation surface. This file is inside the
// tsconfig `include`, so `tsc --noEmit` type-checks the assertions below; if a
// param list in navigation/routes.ts drifts from what the screens consume, the
// build fails here. There is no runtime behaviour beyond the exported flag,
// which the jest routes test asserts so the check also shows up as a green test.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type {
  AskStackParamList,
  TravelStackParamList,
  AccountStackParamList,
  RootStackParamList,
} from '../navigation/routes';

// --- tiny type-level equality helpers ---
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

// --- the param shapes each ported screen relies on ---
type _Execution = Expect<Equal<AskStackParamList['Execution'], { executionId: string }>>;
type _Thread = Expect<Equal<AskStackParamList['Thread'], { threadId?: string; seed?: string } | undefined>>;

type _FlightResults = Expect<Equal<TravelStackParamList['FlightResults'], { searchId: string }>>;
type _StayRooms = Expect<Equal<TravelStackParamList['StayRooms'], { propertyId: string; searchId: string }>>;
type _Passenger = Expect<Equal<TravelStackParamList['PassengerDetails'], { cartId: string; index: number }>>;
type _Checkout = Expect<Equal<TravelStackParamList['Checkout'], { cartId: string }>>;
type _Attach = Expect<Equal<
  TravelStackParamList['AttachAirportRide'],
  { orderId: string; direction: 'to_airport' | 'from_airport' }
>>;

type _MandateEditor = Expect<Equal<AccountStackParamList['MandateEditor'], { mandateId?: string } | undefined>>;
type _MandateReceipt = Expect<Equal<AccountStackParamList['MandateReceipt'], { executionId: string }>>;

// The two typings the handoff calls out must agree: RouteProp<...>['params'] is
// exactly the params carried by NativeStackScreenProps<...>['route'].
type _RoutePropParity = Expect<Equal<
  RouteProp<TravelStackParamList, 'AttachAirportRide'>['params'],
  NativeStackScreenProps<TravelStackParamList, 'AttachAirportRide'>['route']['params']
>>;

// The nested navigators are reachable from the root param list.
type _RootHasAsk = Expect<Extends<'Ask', keyof RootStackParamList>>;
type _RootHasTravel = Expect<Extends<'Travel', keyof RootStackParamList>>;

export const routeAssertions = true;
