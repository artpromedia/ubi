"use client";

/**
 * Which fleet the signed-in staff member is working in, and their role
 * there (FleetView.myRole — fleet-service's staff table, never a client
 * claim).
 *
 * `FleetGate` decides the whole portal's state before any screen renders:
 * signed out, the `fleet` flag off in the caller's city (every surface shows
 * the honest "not available yet" state — no preview data), no fleet linked
 * to the account, or the selected fleet. The selection is a per-browser
 * convenience (localStorage), re-validated against the server's list.
 */
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { EmptyState, ReadGate } from "@/components/states/states";
import { toReadState, type ReadState } from "@/lib/access";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useOnlineStatus } from "@/lib/hooks";

import type { FleetList, FleetView } from "@/lib/fleet-types";

const SELECTED_KEY = "fleet_selected";

interface FleetContextValue {
  readonly state: ReadState<FleetList>;
  readonly fleet: FleetView | null;
  readonly fleets: readonly FleetView[];
  readonly select: (fleetId: string) => void;
  readonly retry: () => void;
}

const FleetContext = createContext<FleetContextValue | null>(null);

const readSelected = (): string | null => {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
};

/** The fleet to open: the remembered one if it is still in the list, else the first. */
export function pickFleet(
  fleets: readonly FleetView[],
  remembered: string | null,
): FleetView | null {
  return (
    fleets.find((fleet) => fleet.fleetId === remembered) ?? fleets[0] ?? null
  );
}

export const FleetProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const online = useOnlineStatus();
  const [selected, setSelected] = useState<string | null>(readSelected);
  const query = useQuery({
    queryKey: fleetKeys.fleets(),
    queryFn: ({ signal }) => fleetApi.listFleets(signal),
  });
  const state = toReadState(query, online, "your fleet");
  const fleets = useMemo(
    () => (state.kind === "ready" ? state.data.fleets : []),
    [state],
  );
  const value = useMemo<FleetContextValue>(
    () => ({
      state,
      fleets,
      fleet: pickFleet(fleets, selected),
      select: (fleetId: string) => {
        setSelected(fleetId);
        try {
          window.localStorage.setItem(SELECTED_KEY, fleetId);
        } catch {
          /* a convenience only */
        }
      },
      retry: () => {
        void query.refetch();
      },
    }),
    [state, fleets, selected, query],
  );
  return (
    <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
  );
};

export const useFleetContext = (): FleetContextValue => {
  const value = useContext(FleetContext);
  if (value === null) {
    throw new Error("useFleetContext outside FleetProvider");
  }
  return value;
};

/** The selected fleet — only call inside `FleetGate`. */
export const useSelectedFleet = (): FleetView => {
  const { fleet } = useFleetContext();
  if (fleet === null) {
    throw new Error("useSelectedFleet outside FleetGate");
  }
  return fleet;
};

/** The portal-wide state gate (pure: tested with each state). */
export const FleetGateView = ({
  state,
  fleet,
  onRetry,
  children,
}: {
  readonly state: ReadState<FleetList>;
  readonly fleet: FleetView | null;
  readonly onRetry?: () => void;
  readonly children: ReactNode;
}) => (
  <ReadGate
    state={state}
    loadingLabel="Loading your fleet…"
    context="your fleet"
    zone={fleet?.zone ?? "UTC"}
    onRetry={onRetry}
  >
    {() =>
      fleet === null ? (
        <EmptyState
          title="No fleet is linked to your UBI account in this city."
          body="Fleet accounts are set up with UBI. Once you're added as a fleet owner, manager or read-only member, your fleet opens here."
        />
      ) : (
        children
      )
    }
  </ReadGate>
);

export const FleetGate = ({ children }: { readonly children: ReactNode }) => {
  const { state, fleet, retry } = useFleetContext();
  return (
    <FleetGateView state={state} fleet={fleet} onRetry={retry}>
      {children}
    </FleetGateView>
  );
};
