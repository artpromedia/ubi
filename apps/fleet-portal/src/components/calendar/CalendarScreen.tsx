"use client";

/**
 * The calendar container: controls (from and back to the URL), the paged
 * server query (40 rows a page, refreshed every minute) and the board.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import { toReadState } from "@/lib/access";
import {
  calendarQuery,
  controlsFromSearch,
  controlsToSearch,
  mergePages,
  todayIn,
  type CalendarControls,
} from "@/lib/calendar-controls";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useNow, useOnlineStatus } from "@/lib/hooks";

import { CalendarBoard } from "./CalendarBoard";

export const CalendarScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const now = useNow();
  const today = todayIn(fleet.zone, now);
  const params = useSearchParams();
  const [controls, setControls] = useState<CalendarControls>(() =>
    controlsFromSearch(new URLSearchParams(params.toString()), today),
  );
  const onControls = useCallback((next: Partial<CalendarControls>) => {
    setControls((current) => {
      const merged = { ...current, ...next };
      try {
        window.history.replaceState(null, "", `?${controlsToSearch(merged)}`);
      } catch {
        /* the URL is a convenience */
      }
      return merged;
    });
  }, []);

  const query = calendarQuery(controls, fleet.zone);
  const pages = useInfiniteQuery({
    queryKey: fleetKeys.calendar(fleet.fleetId, query),
    queryFn: ({ pageParam, signal }) =>
      fleetApi.calendar(fleet.fleetId, { ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });
  const vehicles = useQuery({
    queryKey: fleetKeys.vehicles(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.vehicles(fleet.fleetId, signal),
    enabled: controls.rows === "drivers",
  });
  const plates = useMemo(
    () =>
      new Map(
        (vehicles.data?.vehicles ?? []).map((vehicle) => [
          vehicle.vehicleId,
          vehicle.plate,
        ]),
      ),
    [vehicles.data],
  );
  const merged = mergePages(pages.data?.pages ?? []);
  const state = toReadState(
    {
      data: merged,
      error: pages.error,
      isError: pages.isError,
      fetchStatus: pages.fetchStatus,
      dataUpdatedAt: pages.dataUpdatedAt,
    },
    online,
    "the calendar",
  );

  return (
    <CalendarBoard
      fleet={fleet}
      state={state}
      controls={controls}
      onControls={onControls}
      now={now}
      online={online}
      plates={plates}
      today={today}
      onLoadMore={() => void pages.fetchNextPage()}
      loadingMore={pages.isFetchingNextPage}
      onRetry={() => void pages.refetch()}
    />
  );
};
