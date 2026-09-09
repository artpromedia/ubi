# Visual acceptance + screen-state coverage

Recreate pixel-close from the boards using tokens; copy is final unless marked fixture. Each row: board id → RN/web file → states that must exist → interaction spec.

## NEW-01 Ask UBI + mandates
| Board | File | States | Interaction |
|---|---|---|---|
| 20a home | rider `screens/home/HomeScreen.tsx` | flags loading · Ask entry hidden when ai_assistant off · active trip banner | Ask entry ≥ 54 px tall; tiles 2-col grid |
| 20a thread | `screens/ask/AskScreen.tsx` | empty (suggested prompts) · streaming · plan with LIVE/SUGGESTION cards · quote expired ("Refresh prices") · offline ("as of") · error/retry | SSE tokens append; cards animate in ≤ 200 ms (reduced motion: none); "Edit in form" → Travel.FlightSearch with prefilled params |
| 20b clarify | `components/ask/ClarifyForm.tsx` | chips · passenger row · submit disabled until required filled | chips 44 pt; VoiceOver reads group label |
| 20b sources | `components/ask/AnswerSources.tsx` | collapsed/expanded · none | tap opens policy doc sheet |
| 20b review | `screens/ask/TransactionReviewSheet.tsx` | awaiting · countdown · expired · repriced (diff highlighted) · PIN · error | sheet 92% max; PIN via existing SecureConfirm; countdown announced at 1:00 and 0:10 |
| 20c status | `screens/ask/ExecutionStatusScreen.tsx` | processing · supplier pending · confirmed · partial · failed/released · unknown (reconciling) | poll 15 s + realtime; no "pay again" copy anywhere |
| 20c handoff | `screens/ask/HandoffSheet.tsx` | consent on/off · wait time · offline | opens support case; transcript toggle default on |
| 20d list/editor/receipt | `screens/automation/*` | active/paused/revoked/expired · used vs cap · blocked run reason · PIN save | revoke needs confirm + PIN; caps inputs numeric keyboard, currency formatting from config |

## NEW-02 Travel
| Board | File | States |
|---|---|---|
| 21a search | `screens/travel/FlightSearchScreen.tsx` | return/one-way · add hotel toggle · recent trips · flag off |
| 21a results | `FlightResultsScreen.tsx` | loading skeleton · results · sold out row · price guaranteed chip (adapter field only) · expired ("Refresh") · offline · no results |
| 21b rates | `StayRoomsScreen.tsx` | pay-now · pay-at-property · FX line · occupancy blocked · cancellation deadline (WAT) |
| 21b passenger | `PassengerDetailsScreen.tsx` | verified identity prefill · manual · validation errors · save passenger |
| 21b checkout | `TravelCheckoutScreen.tsx` | breakdown · terms · savings none/eligible · repriced diff · payment method · PIN · pending |
| 21c ladder | `OrderStatusScreen.tsx` | 6 ladder states + unknown_reconciling |
| 21c itinerary | `ItineraryScreen.tsx` | per-item status pills · not reserved ride · not booked return · share |
| 21d refund | `RefundStatusScreen.tsx` | requested · supplier approved · refunded to wallet · rejected (reason) |
| 21d disruption | `DisruptionScreen.tsx` | covered (₦0 alternatives, heldUntil) · not covered (airline statutory options first) · loading |
| 21e attach | `AttachAirportRideScreen.tsx` | suggested time + alternates · class · terms · confirm |
| 21e linked | `LinkedOrdersScreen.tsx` | ticketed + not reserved · both ok · both failed |

## NEW-03 / NEW-04 Growth
| Board | File | States |
|---|---|---|
| 22a quote | `components/ride/SavingsBreakdown.tsx` + `SavingsChangedBanner.tsx` | eligible · partial · exhausted · expired · min spend not met · offline (no savings) · 409 quote_changed |
| 22b benefits | `screens/benefits/BenefitsScreen.tsx` | credit (multi-expiry) · offers active/scheduled/used up · changes earned/reversed (reason + terms link) · empty |
| 22b referrals | `ReferralsScreen.tsx` | share · list: qualifying/in review/rewarded/reversed/expired · cap reached · empty |
| 22c strip | driver `components/IncentiveStrip.tsx` | window live · rebate live · none (hidden) · read-only while moving |
| 22c overview | `screens/incentives/IncentivesScreen.tsx` | rebate · window · referral milestones · quest · empty |
| 22d detail | `CommissionDetailScreen.tsx` | pp vs % note · worked example from last trip · none |
| 22d statement | `screens/earnings/StatementScreen.tsx` | draft/paid · rebate/window/reversal lines · export |

## NEW-05 Admin + web
23a campaign form (draft/validation/simulated/submitted) · 23b list (8 states) + outcome (metrics with denominator/window/CI) · 23c queue + case (qualify/hold/deny with reason) · 23d assistant (evidence/assumptions/budget; save draft) · 23e exceptions (pending ticketing, unknown, refund, settlement) + AI actions (done/partial/blocked/refused) · 23f web travel + Ask panel · mobile web trip + handoff banner + fallback.

## Global
Light + dark from tokens · dynamic type to 200% without clipping (FlatList rows grow) · screen reader labels for money ("… naira"), plates, status words · 44 pt iOS / 48 dp Android · reduced motion honoured · offline banner + "as of" timestamps · keyboard avoiding on forms · RTL not required for launch locales.
