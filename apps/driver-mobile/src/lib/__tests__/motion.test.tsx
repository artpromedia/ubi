import React from 'react';
import { Text, Pressable } from 'react-native';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { installFixtures } from '@ubi/mobile-core';
import { useMotionGate, resetMotionForDev, setMotionForDev } from '../motion';

// Task C: the motion model is driven only by the explicit parked attestation
// (POST /v1/mp/driver/parked, adopting the state the SERVER acknowledges) and dev
// signals. It can HIDE bidding, but never enables it on the client's say-so alone.
function Probe() {
  const gate = useMotionGate();
  return (
    <>
      <Text testID="motion">{gate.motion}</Text>
      <Pressable testID="confirm" onPress={() => { void gate.confirmParked(); }}><Text>confirm</Text></Pressable>
    </>
  );
}

describe('useMotionGate', () => {
  beforeEach(() => resetMotionForDev());

  it('starts honest: stale_location until something proves otherwise', () => {
    render(<Probe />);
    expect(screen.getByTestId('motion').props.children).toBe('stale_location');
  });

  it('adopts the state the server acknowledges on the parked attestation', async () => {
    installFixtures(async ({ method, path }) => {
      if (method === 'POST' && path === '/v1/mp/driver/parked') {
        return { status: 200, json: { state: 'parked_confirmed', availabilityEpoch: 8, confirmedAt: new Date().toISOString() } };
      }
      return undefined;
    });
    render(<Probe />);
    fireEvent.press(screen.getByTestId('confirm'));
    await waitFor(() => expect(screen.getByTestId('motion').props.children).toBe('parked_confirmed'));
  });

  it('does NOT flip to parked when the server refuses the attestation', async () => {
    installFixtures(async ({ method, path }) => {
      if (method === 'POST' && path === '/v1/mp/driver/parked') {
        // Server telemetry disagrees — it keeps the driver paused.
        return { status: 200, json: { state: 'stale_location', availabilityEpoch: 8, confirmedAt: new Date().toISOString() } };
      }
      return undefined;
    });
    render(<Probe />);
    fireEvent.press(screen.getByTestId('confirm'));
    await waitFor(() => expect(screen.getByTestId('motion').props.children).toBe('stale_location'));
  });

  it('dev signal can force the moving state for D07 demos', () => {
    render(<Probe />);
    act(() => setMotionForDev('moving'));
    expect(screen.getByTestId('motion').props.children).toBe('moving');
  });
});
