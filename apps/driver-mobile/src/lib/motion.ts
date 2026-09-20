// Motion gate model (D07 / task C). There is NO location plumbing in this app yet —
// production telemetry (react-native-background-geolocation → presence service) is
// RN-02 scope. Until then the client-side belief is driven by exactly two inputs:
//   1. the explicit "I am safely parked" attestation, which POSTs
//      /v1/mp/driver/parked and adopts the state the SERVER acknowledges;
//   2. dev/fixture signals (__DEV__ only) so every D01/D07 state is exercisable.
//
// The server remains the authority throughout: this hook only ever HIDES bidding
// UI (moving ⇒ bid controls are not rendered at all). It never enables bidding on
// its own — the marketplace engine re-evaluates eligibility per request and
// rejects with NOT_STATIONARY, and the UI renders that reason (D10).
import { useEffect, useState } from 'react';
import { track } from '@ubi/mobile-core';
import { marketplaceApi } from '../api/marketplace';

export type MotionState = 'parked_confirmed' | 'moving' | 'stale_location';

// Honest default: with no telemetry and no attestation yet, the location signal
// is stale — bidding stays paused rather than silently pretending to be parked.
let current: MotionState = 'stale_location';
const listeners = new Set<(s: MotionState) => void>();
function set(next: MotionState) {
  if (next === current) return;
  current = next;
  for (const l of listeners) l(next);
}

/** Dev/fixture signal only (task C input 2). No-op in production builds. */
export function setMotionForDev(next: MotionState) {
  if (__DEV__) set(next);
}
/** Test/dev reset so suites start from the honest default. */
export function resetMotionForDev() {
  if (__DEV__) set('stale_location');
}
export function currentMotion(): MotionState {
  return current;
}

export type MotionGate = {
  motion: MotionState;
  /** True only while the parked attestation round-trip is in flight. */
  confirming: boolean;
  /** Server-phrased failure of the last attestation, if any. */
  confirmError: string | null;
  /** Explicit "I am safely parked" attestation → POST /v1/mp/driver/parked. */
  confirmParked: () => Promise<void>;
};

export function useMotionGate(): MotionGate {
  const [motion, setMotion] = useState<MotionState>(current);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  useEffect(() => {
    const l = (s: MotionState) => setMotion(s);
    listeners.add(l);
    setMotion(current); // catch a change between render and subscribe (React bails out when unchanged)
    return () => { listeners.delete(l); };
  }, []);
  const confirmParked = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      // The state we adopt is the one the server acknowledged, never a local guess.
      const ack = await marketplaceApi.parked();
      set(ack.state);
      track('driver_mp_parked_confirmed', { state: ack.state });
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Could not confirm — try again.');
    } finally {
      setConfirming(false);
    }
  };
  return { motion, confirming, confirmError, confirmParked };
}
