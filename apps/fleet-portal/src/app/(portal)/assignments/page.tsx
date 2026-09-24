"use client";

import { Suspense } from "react";

import { AssignmentsScreen } from "@/components/assignments/Assignments";
import { LoadingState } from "@/components/states/states";

/** B7: propose assignments and follow consent; signed arrangements. */
const AssignmentsPage = () => (
  <Suspense fallback={<LoadingState label="Loading assignments…" />}>
    <AssignmentsScreen />
  </Suspense>
);

export default AssignmentsPage;
