"use client";
import React from "react";

/** A03 + A07 — presentational component wired by src/app/(admin)/marketplace/policies/page.tsx.
 * Commission is rendered read-only at 10% (not grantable to any role). Unconfigured floor inputs
 * block production publish (fail closed). Publish requires a second approver. The kill switch stops
 * NEW publications/awards only — existing bids/holds/awards resolve; it never reverts active jobs. */
export type PolicyField = {
  label: string;
  value: string;
  mono?: boolean;
  invalid?: boolean;
};
export type AuditEntry = { version: string; line: string };
export type PolicyEditorProps = {
  scopeLine: string;
  activeVersion: string;
  bounds: PolicyField[];
  boundsError: string | null;
  presets: PolicyField[];
  envelopes: PolicyField[]; // A07: radius/ETA/expansion/dwell/corridor/tolerance
  previewLine: string | null; // simulation result against recorded traffic
  audit: AuditEntry[];
  roleLine: string;
  killSwitchScope: string;
  canPublish: boolean;
  onSaveDraft: () => void;
  onPublish: () => void;
  onStopAwards: () => void;
};

function FieldGrid({ fields }: { fields: PolicyField[] }) {
  return (
    <div className="flex gap-3">
      {fields.map((f) => (
        <div key={f.label} className="min-w-0 flex-1">
          <div className="mb-1 text-xs text-neutral-500">{f.label}</div>
          <div
            className={
              "flex h-9 items-center truncate rounded-lg border px-3 text-sm font-semibold " +
              (f.invalid
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-neutral-200 bg-white text-neutral-900") +
              (f.mono ? " font-mono text-xs font-normal" : "")
            }
          >
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PolicyEditorPage(p: PolicyEditorProps) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 font-semibold text-lg text-neutral-900">
          {p.scopeLine} — {p.activeVersion}{" "}
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-700">
            Active
          </span>
        </h1>
        <button
          data-testid="mp.admin.policy.stopAwards"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
          onClick={p.onStopAwards}
        >
          Stop new awards
        </button>
      </div>
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-neutral-900">
          Fare bounds{" "}
          <span className="text-xs font-normal text-neutral-400">
            — required before market activation; unconfigured markets fail
            closed
          </span>
        </h2>
        <FieldGrid fields={p.bounds} />
        {p.boundsError ? (
          <p className="mt-2 text-xs text-red-700">{p.boundsError}</p>
        ) : null}
      </section>
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-neutral-900">
          Bid presets &amp; expiry
        </h2>
        <FieldGrid fields={p.presets} />
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-neutral-100 px-3 py-2.5">
          <span className="flex-1 text-sm font-semibold text-neutral-900">
            Marketplace commission
          </span>
          <span className="font-semibold text-neutral-900">
            10% · 1,000 bps
          </span>
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
            Fixed · not editable
          </span>
        </div>
      </section>
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-neutral-900">
          Search &amp; queue envelopes{" "}
          <span className="font-mono text-xs font-normal text-neutral-400">
            A07
          </span>
        </h2>
        <FieldGrid fields={p.envelopes} />
        <div className="mt-3 flex items-center gap-3">
          {p.previewLine ? (
            <div className="flex-1 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-neutral-900">
              <b>Preview:</b> {p.previewLine}
            </div>
          ) : null}
          <button
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-900"
            onClick={p.onSaveDraft}
          >
            Save draft
          </button>
          <button
            data-testid="mp.admin.policy.publish"
            disabled={!p.canPublish}
            className="rounded-lg bg-admin-secondary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            onClick={p.onPublish}
          >
            Publish · requires 2nd approver
          </button>
        </div>
      </section>
      <div className="grid grid-cols-3 gap-4">
        <section
          className="rounded-xl border border-neutral-200 bg-white p-4"
          data-testid="mp.admin.policy.audit"
        >
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Change audit
          </h3>
          {p.audit.map((a) => (
            <p
              key={a.version}
              className="border-b border-neutral-100 py-2 text-xs text-neutral-500 last:border-0"
            >
              <b className="text-neutral-900">{a.version}</b> · {a.line}
            </p>
          ))}
        </section>
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Your role
          </h3>
          <p className="text-xs text-neutral-500">{p.roleLine}</p>
        </section>
        <section className="rounded-xl bg-amber-50 p-4">
          <p className="text-xs text-neutral-900">
            <b>Kill switch scope:</b> {p.killSwitchScope}
          </p>
        </section>
      </div>
    </div>
  );
}
