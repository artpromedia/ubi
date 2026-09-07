# Slice 12 — Android parity, testIDs, Maestro, accessibility
Board: 16d–16g (Android sweep of 1e/1g/1i/1j), 5a–5b, 1a (targets).

## Rules
Same tokens, same copy, same contract; only the platform shell changes. Gesture nav pill; status bar 40dp; bottom sheets radius 28 and clear the 24dp nav area; 48dp targets (primary 56dp, rows ≥56dp); back = system gesture plus in-screen arrows; Poppins/Inter bundled (no Roboto substitution). Offer arrives as full-screen intent + heads-up when backgrounded; in-trip navigation runs as a foreground service with a persistent notification mirroring the turn banner. Back gesture is a no-op on the cash-acknowledge screen until acknowledged.

## Accessibility
Text ≥ 12.5px; contrast AA in both themes; status always as text (never map/colour only); live regions for ETA and search results; plate + vehicle read as one label; money announced with currency.

## testIDs and Maestro
Apply the convention in CLAUDE.md to every screen. Maestro flows to ship (names referenced in slices): rider_happy_path_cash, driver_happy_path, rider_driver_cancel_rematch, rider_offline_reconnect, sos_safety_hold, new_device_signin_limited_mode, pin_locked_reset_selfie, driver_liveness_gate, wallet_send_p2p, split_fare_request_pay, nip_transfer_pending_confirmed, insufficient_funds_topup_and_send, bites_order_happy_path, bites_missing_item_refund, merchant_reject_sold_out, send_create_pickup_deliver, send_recipient_unavailable_retry, send_damage_claim, flights_search_pay, flights_cancelled_switch_free, desk_scan_switch, journey_book_both_rides, landed_pickup_door3, flight_switch_retimes_rides, return_leg_reserved_pickup, stays_search_pay_in_journey, stays_express_checkin, stays_flight_cancelled_keep_move_cancel, fleet_assign_driver_sign_pin, driver_view_arrangement_split.

## Claude Code prompt
"Run the Android parity pass on rider_app and driver_app for every screen in slices 02–10: verify tokens, targets, sheet radii, foreground service for navigation, full-screen intent for offers; add all testIDs from CLAUDE.md; write the Maestro flows listed; add golden tests for 16d–16g in light and dark."
