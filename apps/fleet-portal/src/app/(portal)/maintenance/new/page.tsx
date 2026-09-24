"use client";

import { Suspense } from "react";

import { MaintenanceEditorScreen } from "@/components/maintenance/MaintenanceEditor";
import { LoadingState } from "@/components/states/states";

/** B5: the maintenance editor with its server impact preview, and "Report off-road". */
const NewMaintenancePage = () => (
  <Suspense fallback={<LoadingState label="Loading…" />}>
    <MaintenanceEditorScreen />
  </Suspense>
);

export default NewMaintenancePage;
