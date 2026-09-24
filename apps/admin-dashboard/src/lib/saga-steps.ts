/**
 * Operator vocabulary for the stuck-saga and recovery boards.
 *
 * `step` / `attemptState` come from ride-service's mp.award_attempts ledger
 * (store_awards.go AttemptStep*, delivery_handoff.go AttemptStepHandoff) and
 * `action` from mp.reservation_recovery (store.go Recovery*, funding.go
 * RecoveryFundingRelease). Each label says what the step is and what the
 * EXISTING reconcile/retry command will — and will not — do to it, so the
 * preview an operator confirms is specific to the row. A step or action
 * this build does not know is shown verbatim and flagged, never mislabelled.
 *
 * `OWED_WORK_WITHOUT_ADMIN_READ` names the durable owed operations that the
 * rounds 5–7 sagas added but that NO admin endpoint lists yet — so the board
 * says where they live instead of implying the two lists above are complete.
 */

export type StepInfo = {
  label: string;
  detail: string;
  /** What a reconcile of an award parked at this step does. */
  reconcileNote: string;
  known: boolean;
};

const STEPS: Record<string, Omit<StepInfo, "known">> = {
  "": {
    label: "Not started",
    detail: "No saga attempt row yet; the sweep starts it.",
    reconcileNote: "Reconciling starts the saga at its first step (funding).",
  },
  funding: {
    label: "Funding",
    detail:
      "Rider funding authorization — or, on a business award, the organization budget reserve (business:<award>:reserve).",
    reconcileNote:
      "Reconciling re-polls the funding authorization (or the organization budget reserve on a business award) under the award's existing key — never a second authorization or reservation.",
  },
  capture: {
    label: "Commission capture",
    detail: "The one 10% commission capture under the award id.",
    reconcileNote:
      "Reconciling re-polls the one commission capture under the award id; the fee is captured at most once, never re-charged.",
  },
  delivery_handoff: {
    label: "Delivery hand-off",
    detail:
      "Hand-off of a delivery award to delivery-service after capture; touches no money.",
    reconcileNote:
      "Reconciling re-sends the hand-off; delivery-service is idempotent on the award id, so a re-send replays the ONE delivery. No money moves.",
  },
  finalize: {
    label: "Finalize",
    detail: "Writes the execution and confirms the award; no money moves.",
    reconcileNote:
      "Reconciling finishes confirming the award and its execution; no money moves.",
  },
  compensating: {
    label: "Compensating",
    detail:
      "Linked reversal of a captured fee and release of rider funding (or the organization reservation).",
    reconcileNote:
      "Reconciling continues the compensation with linked entries only — a captured fee is reversed once, funding released once; nothing is re-charged.",
  },
};

export function stepInfo(step: string): StepInfo {
  const known = STEPS[step];
  return known
    ? { ...known, known: true }
    : {
        label: step,
        detail: "Unrecognised saga step in this build — shown verbatim.",
        reconcileNote:
          "Reconciling asks the engine to advance whatever step the sweep would take next; this build cannot describe it.",
        known: false,
      };
}

const ATTEMPT_STATES: Record<string, string> = {
  pending: "in flight",
  unknown: "outcome unknown — the sweep is re-polling",
  done: "done",
  failed: "failed",
  "": "no attempt yet",
};
export const attemptStateLabel = (state: string): string =>
  ATTEMPT_STATES[state] ?? state;

export type RecoveryInfo = {
  label: string;
  retryNote: string;
  known: boolean;
};

const RECOVERIES: Record<string, Omit<RecoveryInfo, "known">> = {
  release: {
    label: "Bid hold release",
    retryNote:
      "Retrying re-sends the commission-hold release under the same wallet key; a released hold cannot be released twice.",
  },
  adjust: {
    label: "Bid hold adjustment",
    retryNote:
      "Retrying re-sends the linked hold adjustment under the same wallet key.",
  },
  reverse: {
    label: "Commission reversal",
    retryNote:
      "Retrying re-drives the linked reversal of the captured commission, only once the award is off the confirmed path; it never reverses twice.",
  },
  reserve_replay: {
    label: "Reserve replay",
    retryNote:
      "Retrying replays the reserve under the SAME idempotency key to learn the real reservation, then releases that reservation.",
  },
  settle: {
    label: "Completion settlement",
    retryNote:
      "Retrying re-sends the completion settlement, idempotent on the award id.",
  },
  funding_release: {
    label: "Rider funding release",
    retryNote:
      "Retrying re-sends the rider funding release under the award's one release key.",
  },
};

export function recoveryInfo(action: string): RecoveryInfo {
  const known = RECOVERIES[action];
  return known
    ? { ...known, known: true }
    : {
        label: action,
        retryNote:
          "Retrying calls the same recovery action the sweep uses; this build cannot describe it.",
        known: false,
      };
}

export type OwedWorkGap = {
  key: string;
  title: string;
  where: string;
  missingEndpoint: string;
};

/**
 * Owed operations added by the rounds 5–7 sagas that are durable and swept
 * by ride-service/notification-service, but have no admin list endpoint.
 * The ride-service ones surface per request on the Cases resolution view
 * only (business funding as its own stage).
 */
export const OWED_WORK_WITHOUT_ADMIN_READ: readonly OwedWorkGap[] = [
  {
    key: "business_budget",
    title: "Business budget commit / release owed",
    where:
      "mp.business_bookings.owed_op (ride-service; swept until payment-service answers). Visible per request as the business_funding stage on Cases.",
    missingEndpoint: "GET /v1/admin/mp/business-bookings?owed=true",
  },
  {
    key: "delivery_cancel",
    title: "Queued delivery cancellation owed",
    where:
      "mp.delivery_cancellations (ride-service; driven until delivery-service answers definitely).",
    missingEndpoint: "GET /v1/admin/mp/delivery-cancellations?state=pending",
  },
  {
    key: "trip_link_sms",
    title: "Sealed passenger trip-link SMS delivery",
    where:
      "trip_access.issued is written in the booking transaction; notification-service opens the sealed envelope and sends the SMS. Its delivery outcome is internal state.",
    missingEndpoint: "GET /admin/mp/notifications/dlq (notification-service)",
  },
];
