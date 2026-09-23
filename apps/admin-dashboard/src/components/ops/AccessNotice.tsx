"use client";
import React from "react";

import type { AccessState } from "../../lib/access";

/**
 * The one rendering of a classified read/command failure (lib/access.ts):
 * signed out, wrong role, unverified device, safe mode, offline, not found,
 * or a plain error. Each kind has its own test id so a board can never pass
 * off "you may not see this" as "there is nothing to see".
 */
const TONE: Record<AccessState["kind"], string> = {
  unauthenticated: "border-amber-200 bg-amber-50 text-amber-900",
  forbidden: "border-red-200 bg-red-50 text-red-800",
  device_unverified: "border-amber-200 bg-amber-50 text-amber-900",
  safe_mode: "border-amber-200 bg-amber-50 text-amber-900",
  feature_disabled: "border-neutral-200 bg-neutral-50 text-neutral-700",
  not_found: "border-neutral-200 bg-neutral-50 text-neutral-700",
  offline: "border-neutral-300 bg-neutral-100 text-neutral-800",
  error: "border-red-200 bg-red-50 text-red-800",
};

export function AccessNotice({
  state,
  context,
}: {
  state: AccessState;
  /** What could not be loaded, e.g. "pending sagas". */
  context?: string;
}) {
  return (
    <div
      role="alert"
      className={"rounded-xl border p-3 text-xs " + TONE[state.kind]}
      data-testid={"ops.access." + state.kind}
    >
      <b>{state.title}</b>
      {context ? <span> — {context}</span> : null}
      <p className="mt-1">{state.message}</p>
    </div>
  );
}
