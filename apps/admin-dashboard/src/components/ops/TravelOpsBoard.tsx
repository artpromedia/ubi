"use client";
import React, { useState } from "react";

import { AccessNotice } from "./AccessNotice";
import { classifyError, type AccessState } from "../../lib/access";
import {
  ACTION_COPY,
  ITINERARY_GAPS,
  TRANSFERS_GAP,
  type ExceptionAction,
  type ExceptionRow,
  type ItineraryRow,
  type NamedGap,
  type ProviderCard,
  type Tone,
} from "../../lib/travel-ops";

/**
 * Board 23e (left) — travel exceptions, provider health, airport transfers
 * and the joined-orders itinerary view, inside the existing ops console.
 *
 * Rules this board keeps (CLAUDE.md #24/#25, design flow 6):
 *   - unknown results: lookup by UBI ref only; never re-book;
 *   - every action is previewed with what it does and confirmed once;
 *   - money is the server's {amountMinor, currency}, formatted, never summed;
 *   - an itinerary joins orders for READING only — each order keeps its own
 *     status, charge, ledger and audit trail, and there is no "settle all";
 *   - what no endpoint provides (ops-wide transfers, per-order money state,
 *     commission vs travel margin) is a named gap, not a guess.
 */
export type TravelOpsBoardProps = {
  offline: boolean;
  exceptions: {
    loading: boolean;
    error: AccessState | null;
    rows: ExceptionRow[];
  };
  providers: {
    loading: boolean;
    error: AccessState | null;
    cards: ProviderCard[];
    settlementLine: string;
    generatedAt?: string;
  };
  pendingAction: {
    orderId: string;
    action: ExceptionAction;
    busy: boolean;
  } | null;
  actionResult: { tone: "ok" | "err"; text: string } | null;
  onRequestAction: (orderId: string, action: ExceptionAction) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
  trip: {
    lookedUp: string | null;
    loading: boolean;
    error: AccessState | null;
    title: string | null;
    dates: string | null;
    rows: ItineraryRow[];
  };
  onLookupTrip: (tripId: string) => void;
};

const KIND_TONE: Record<Tone, string> = {
  danger: "bg-red-50 text-red-700",
  warn: "bg-amber-50 text-amber-700",
  info: "bg-sky-50 text-sky-700",
  neutral: "bg-neutral-100 text-neutral-600",
};

const TRIP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function GapPanel({ gap, testId }: { gap: NamedGap; testId: string }) {
  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-neutral-900"
      data-testid={testId}
    >
      <p className="font-semibold">{gap.title}</p>
      <p className="mt-1 text-neutral-700">{gap.detail}</p>
      <p className="mt-1 text-neutral-700">
        Missing: <code className="font-mono">{gap.missingEndpoint}</code>
      </p>
    </div>
  );
}

const PROVIDER_TONE: Record<ProviderCard["tone"], string> = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  neutral: "text-neutral-600",
};

function ProviderCards({
  providers,
}: {
  providers: TravelOpsBoardProps["providers"];
}) {
  if (providers.error) {
    return <AccessNotice state={providers.error} context="provider health" />;
  }
  if (providers.loading) {
    return <p className="text-xs text-neutral-500">Loading providers…</p>;
  }
  if (providers.cards.length === 0) {
    return <p className="text-xs text-neutral-500">No suppliers configured.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {providers.cards.map((c) => (
        <div
          key={c.supplierId}
          data-testid="ops.travel.provider"
          className={
            "min-w-48 flex-1 rounded-xl border bg-white p-3 " +
            (c.tone === "warn" ? "border-amber-300" : "border-neutral-200")
          }
        >
          <div className="text-[10px] text-neutral-500">{c.supplierId}</div>
          <div className={"text-sm font-bold " + PROVIDER_TONE[c.tone]}>
            {c.status}
          </div>
          {c.lines.map((l) => (
            <div key={l} className="text-[11px] text-neutral-500">
              {l}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ExceptionsSection(p: TravelOpsBoardProps) {
  const { exceptions } = p;
  if (exceptions.error) {
    return (
      <AccessNotice state={exceptions.error} context="travel exceptions" />
    );
  }
  if (exceptions.loading) {
    return <p className="text-xs text-neutral-500">Loading exceptions…</p>;
  }
  if (exceptions.rows.length === 0) {
    return (
      <p className="text-xs text-neutral-500" data-testid="ops.travel.empty">
        No travel orders need a human right now.
      </p>
    );
  }
  const count = (label: string) =>
    exceptions.rows.filter((r) => r.kindLabel === label).length;
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2 text-[11px] font-semibold">
        <span className={"rounded-full px-2 py-0.5 " + KIND_TONE.danger}>
          {count("PNR · NOT TICKETED")} PENDING TICKETING
        </span>
        <span className={"rounded-full px-2 py-0.5 " + KIND_TONE.warn}>
          {count("UNKNOWN · RECONCILING") + count("PROVIDER UNCERTAIN")}{" "}
          PROVIDER UNCERTAIN
        </span>
        <span className={"rounded-full px-2 py-0.5 " + KIND_TONE.info}>
          {count("REFUND DUE")} REFUNDS DUE
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-xs" data-testid="ops.travel.exceptions">
          <thead className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            <tr className="border-b border-neutral-200 bg-neutral-50">
              {[
                "Order · refs",
                "Item",
                "State · since",
                "Money",
                "Next action",
              ].map((h) => (
                <th key={h} className="px-4 py-2 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exceptions.rows.map((e) => (
              <tr
                key={e.key}
                data-testid="ops.travel.exception"
                className="border-b border-neutral-100 align-top last:border-0"
              >
                <td className="px-4 py-2.5">
                  <div className="font-mono font-semibold text-neutral-900">
                    {e.orderId}
                  </div>
                  <div className="text-neutral-500">{e.refs || "—"}</div>
                </td>
                <td className="px-4 py-2.5 text-neutral-900">{e.item}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                      KIND_TONE[e.kindTone]
                    }
                  >
                    {e.kindLabel}
                  </span>
                  <div className="mt-1 text-neutral-500">
                    {e.state} · {e.since}
                  </div>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-neutral-700">
                  {e.money.length === 0
                    ? "—"
                    : e.money.map((m) => (
                        <div key={m.label}>
                          {m.label} {m.value}
                        </div>
                      ))}
                </td>
                <td className="px-4 py-2.5">
                  {e.waitingOn ? (
                    <div className="mb-1 text-neutral-500">
                      waiting: {e.waitingOn}
                    </div>
                  ) : null}
                  {e.actions.map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={p.pendingAction !== null}
                      data-testid={"ops.travel.action." + a}
                      onClick={() => p.onRequestAction(e.orderId, a)}
                      className="mr-2 text-sky-700 hover:underline disabled:opacity-40"
                    >
                      {ACTION_COPY[a].label}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ItineraryBody({ trip }: { trip: TravelOpsBoardProps["trip"] }) {
  if (trip.lookedUp === null) {
    return (
      <p className="text-xs text-neutral-500">
        Enter a trip id to see its orders side by side — each with its own
        status and its own charge.
      </p>
    );
  }
  if (trip.error) {
    return (
      <AccessNotice state={trip.error} context={"trip " + trip.lookedUp} />
    );
  }
  if (trip.loading) {
    return <p className="text-xs text-neutral-500">Loading itinerary…</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-600">
        <b className="text-neutral-900">{trip.title ?? trip.lookedUp}</b>
        {trip.dates ? " · " + trip.dates : ""} · {trip.rows.length} item(s),
        each with its own status and charge
      </p>
      {trip.rows.length === 0 ? (
        <p
          className="text-xs text-neutral-500"
          data-testid="ops.travel.itineraryEmpty"
        >
          This trip has no orders yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table
            className="w-full text-xs"
            data-testid="ops.travel.itineraryTable"
          >
            <thead className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-200 bg-neutral-50">
                {["Order", "Kind", "Fulfilment", "Money state", "Amount"].map(
                  (h) => (
                    <th key={h} className="px-4 py-2 text-left">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {trip.rows.map((r) => (
                <tr
                  key={r.key}
                  data-testid={
                    r.isTransfer
                      ? "ops.travel.itineraryTransfer"
                      : "ops.travel.itineraryOrder"
                  }
                  className="border-b border-neutral-100 align-top last:border-0"
                >
                  <td className="px-4 py-2 font-mono">{r.ref}</td>
                  <td className="px-4 py-2">
                    <div className="font-semibold text-neutral-900">
                      {r.kind}
                    </div>
                    <div className="text-neutral-500">{r.title}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div>{r.fulfilment}</div>
                    {r.actionRequired ? (
                      <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                        {r.actionRequired}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-neutral-400">not exposed</td>
                  <td className="px-4 py-2 tabular-nums">
                    <div className="font-semibold text-neutral-900">
                      {r.money}
                    </div>
                    {r.moneyNote ? (
                      <div className="text-[10px] text-neutral-500">
                        {r.moneyNote}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-neutral-500">
        Act on one order at a time from its own console (refund, lookup,
        re-request a transfer). There is no combined settlement — each order
        keeps its own ledger, refund rule and audit trail.
      </p>
    </div>
  );
}

function ItinerarySection(p: TravelOpsBoardProps) {
  const [tripId, setTripId] = useState("");
  const trimmed = tripId.trim();
  const valid = TRIP_ID_RE.test(trimmed);
  const { trip } = p;
  return (
    <section data-testid="ops.travel.itinerary">
      <form
        className="mb-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            p.onLookupTrip(trimmed);
          }
        }}
      >
        <h2 className="mr-auto font-semibold text-neutral-900">
          Itinerary · joined orders{" "}
          <span className="text-xs font-normal text-neutral-400">
            coordinated view — no combined settlement
          </span>
        </h2>
        <input
          value={tripId}
          onChange={(e) => setTripId(e.target.value)}
          placeholder="Trip id"
          data-testid="ops.travel.tripId"
          className="w-64 rounded-lg border border-neutral-200 px-2 py-1 font-mono text-xs"
        />
        <button
          type="submit"
          disabled={!valid}
          data-testid="ops.travel.tripOpen"
          className="rounded-lg bg-admin-secondary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Open
        </button>
      </form>
      <ItineraryBody trip={trip} />
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {ITINERARY_GAPS.map((g, i) => (
          <GapPanel
            key={g.title}
            gap={g}
            testId={"ops.travel.itineraryGap." + i}
          />
        ))}
      </div>
    </section>
  );
}

export function TravelOpsBoard(p: TravelOpsBoardProps) {
  return (
    <div className="flex flex-col gap-5 p-4" data-testid="ops.travel.board">
      {p.offline ? <AccessNotice state={classifyError(null, false)} /> : null}

      {p.pendingAction ? (
        <div
          className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900"
          data-testid="ops.travel.confirm"
        >
          <b>
            {ACTION_COPY[p.pendingAction.action].label} ·{" "}
            <span className="font-mono">{p.pendingAction.orderId}</span>
          </b>
          <p className="mt-1">{ACTION_COPY[p.pendingAction.action].confirm}</p>
          <div className="mt-2">
            <button
              type="button"
              data-testid="ops.travel.confirmApply"
              disabled={p.pendingAction.busy || p.offline}
              onClick={p.onConfirmAction}
              className="rounded-lg bg-admin-secondary px-3 py-1 font-semibold text-white disabled:opacity-50"
            >
              {p.pendingAction.busy ? "Applying…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={p.pendingAction.busy}
              onClick={p.onCancelAction}
              className="ml-2 font-semibold underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {p.actionResult ? (
        <p
          data-testid="ops.travel.actionResult"
          className={
            "rounded-xl p-3 text-xs " +
            (p.actionResult.tone === "ok"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800")
          }
        >
          {p.actionResult.text}
        </p>
      ) : null}

      <section data-testid="ops.travel.health">
        <h2 className="mb-2 font-semibold text-neutral-900">
          Provider health{" "}
          <span className="text-xs font-normal text-neutral-400">
            {p.providers.generatedAt ? "as of " + p.providers.generatedAt : ""}
          </span>
        </h2>
        <ProviderCards providers={p.providers} />
        <p className="mt-1 text-[11px] text-neutral-500">
          Unresolved settlement differences: {p.providers.settlementLine}
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-neutral-900">
          Exceptions{" "}
          <span className="text-xs font-normal text-neutral-400">
            lookup by UBI ref only — never re-book
          </span>
        </h2>
        <ExceptionsSection {...p} />
      </section>

      <section data-testid="ops.travel.transfers">
        <h2 className="mb-2 font-semibold text-neutral-900">
          Airport transfers
        </h2>
        <GapPanel gap={TRANSFERS_GAP} testId="ops.travel.transfersGap" />
      </section>

      <ItinerarySection {...p} />
    </div>
  );
}
