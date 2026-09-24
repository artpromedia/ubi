"use client";

import { Suspense } from "react";

import { CalendarScreen } from "@/components/calendar/CalendarScreen";
import { LoadingState } from "@/components/states/states";

/** B1–B3: the fleet calendar (day / week, vehicle / driver rows, agenda). */
const CalendarPage = () => (
  <Suspense fallback={<LoadingState label="Loading calendar…" />}>
    <CalendarScreen />
  </Suspense>
);

export default CalendarPage;
