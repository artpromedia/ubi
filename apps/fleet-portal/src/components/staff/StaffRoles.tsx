"use client";

/**
 * B9 — staff roles: the owner / manager / read-only matrix and the fleet's
 * staff. Only an owner may change roles (the whole list is sent with
 * `PUT …/staff`; fleet-service keeps at least one owner). For anyone else
 * the controls are hidden — not just disabled — and the permission copy
 * says who can. Nobody in a fleet ever sees rider identity, routes or safety
 * evidence: that row is "Never" for every role.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useSelectedFleet } from "@/components/fleet/fleet-context";
import { PermissionNote, ReadGate } from "@/components/states/states";
import { commandErrorText, toReadState, type ReadState } from "@/lib/access";
import { fleetApi, fleetKeys } from "@/lib/fleet-api";
import { useCommand, useOnlineStatus } from "@/lib/hooks";
import { can, permissionCopy, ROLE_LABELS, ROLE_MATRIX } from "@/lib/roles";
import {
  draftFromStaff,
  staffBody,
  staffProblems,
  type StaffDraftEntry,
} from "@/lib/staff-model";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import { cn } from "@/lib/utils";

import type {
  FleetStaffList,
  FleetStaffRole,
  FleetView,
} from "@/lib/fleet-types";

const ROLES: readonly FleetStaffRole[] = ["owner", "manager", "read_only"];

export const RoleMatrix = () => (
  <table
    data-testid={FLEET_TEST_IDS.staff.roleMatrix}
    className="w-full text-xs"
  >
    <caption className="pb-2 text-left text-sm font-semibold text-zinc-100">
      Staff roles
    </caption>
    <thead>
      <tr className="text-left text-zinc-500">
        <th scope="col" className="py-1 font-medium">
          Capability
        </th>
        {ROLES.map((role) => (
          <th key={role} scope="col" className="py-1 font-medium">
            {ROLE_LABELS[role]}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {ROLE_MATRIX.map((row) => (
        <tr key={row.capability} className="border-t border-[#1F1F1F]">
          <th
            scope="row"
            className="py-1.5 text-left font-medium text-zinc-300"
          >
            {row.capability}
          </th>
          {ROLES.map((role) => (
            <td
              key={role}
              className={cn(
                "py-1.5",
                row.cells[role] === "Yes" && "text-[#86EFAC]",
                row.cells[role] === "No" && "text-zinc-500",
                row.cells[role] === "Never" && "text-red-300",
              )}
            >
              {row.cells[role]}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

const StaffEditor = ({
  fleet,
  staff,
  online,
  onSaved,
}: {
  readonly fleet: FleetView;
  readonly staff: FleetStaffList;
  readonly online: boolean;
  readonly onSaved?: () => void;
}) => {
  const [draft, setDraft] = useState<StaffDraftEntry[]>(() =>
    draftFromStaff(staff.staff),
  );
  const [newUser, setNewUser] = useState("");
  const command = useCommand<FleetStaffList>();
  const problems = staffProblems(draft);
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {draft.map((entry, index) => (
          <li
            key={entry.userId || `new-${index}`}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <span className="min-w-[160px] text-zinc-100">
              {entry.displayName ?? entry.userId}
            </span>
            <label className="flex items-center gap-1 text-zinc-400">
              <span className="sr-only">
                Role for {entry.displayName ?? entry.userId}
              </span>
              <select
                value={entry.role}
                onChange={(event) =>
                  setDraft(
                    draft.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            role: event.target.value as FleetStaffRole,
                          }
                        : item,
                    ),
                  )
                }
                className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-100"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setDraft(draft.filter((_, i) => i !== index))}
              className="text-zinc-500 underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1 text-zinc-400">
          Add by UBI user ID
          <input
            value={newUser}
            onChange={(event) => setNewUser(event.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100"
          />
        </label>
        <button
          type="button"
          disabled={newUser.trim() === ""}
          onClick={() => {
            setDraft([
              ...draft,
              { userId: newUser.trim(), role: "read_only", displayName: null },
            ]);
            setNewUser("");
          }}
          className="rounded border border-zinc-600 px-2 py-1 text-zinc-100 disabled:opacity-50"
        >
          Add as read-only
        </button>
      </div>
      {problems.map((problem) => (
        <p key={problem} className="text-xs text-amber-200">
          {problem}
        </p>
      ))}
      <button
        type="button"
        disabled={
          !online || problems.length > 0 || command.state.status === "pending"
        }
        onClick={() =>
          void command
            .run(
              (key) => fleetApi.putStaff(fleet.fleetId, staffBody(draft), key),
              online,
            )
            .then((result) => {
              if (result !== undefined) {
                setDraft(draftFromStaff(result.staff));
                onSaved?.();
              }
            })
        }
        className="rounded-md bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
      >
        {command.state.status === "pending" ? "Saving…" : "Save roles"}
      </button>
      {command.state.status === "done" ? (
        <p className="text-xs text-[#86EFAC]">Roles saved.</p>
      ) : null}
      {command.state.status === "failed" ? (
        <p role="alert" className="text-xs text-red-300">
          {commandErrorText(command.state.error, online)}
        </p>
      ) : null}
    </div>
  );
};

export const StaffRolesView = ({
  fleet,
  state,
  online,
  onSaved,
  onRetry,
}: {
  readonly fleet: FleetView;
  readonly state: ReadState<FleetStaffList>;
  readonly online: boolean;
  readonly onSaved?: () => void;
  readonly onRetry?: () => void;
}) => {
  const canManage =
    can(fleet.myRole, "manage_staff") && fleet.status === "active";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-zinc-100">Staff &amp; roles</h1>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-[#222] bg-[#1A1A1A] p-4">
          <RoleMatrix />
          <p className="mt-3 text-[11px] text-zinc-500">
            You are {ROLE_LABELS[fleet.myRole].toLowerCase()} in {fleet.name}.
            Permission denied hides the controls.
          </p>
        </section>
        <section className="space-y-3 rounded-xl border border-[#222] bg-[#1A1A1A] p-4">
          <h2 className="text-sm font-semibold text-zinc-100">Staff</h2>
          <ReadGate
            state={state}
            loadingLabel="Loading staff…"
            context="staff"
            zone={fleet.zone}
            onRetry={onRetry}
          >
            {(staff) =>
              canManage ? (
                <StaffEditor
                  fleet={fleet}
                  staff={staff}
                  online={online}
                  onSaved={onSaved}
                />
              ) : (
                <div className="space-y-2">
                  <ul className="space-y-1 text-xs">
                    {staff.staff.map((member) => (
                      <li
                        key={member.staffId}
                        className="flex justify-between gap-2"
                      >
                        <span className="text-zinc-100">
                          {member.displayName ?? "Staff member"}
                        </span>
                        <span className="text-zinc-400">
                          {ROLE_LABELS[member.role]}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <PermissionNote>
                    {permissionCopy("manage_staff")}
                  </PermissionNote>
                </div>
              )
            }
          </ReadGate>
        </section>
      </div>
    </div>
  );
};

export const StaffRolesScreen = () => {
  const fleet = useSelectedFleet();
  const online = useOnlineStatus();
  const client = useQueryClient();
  const staff = useQuery({
    queryKey: fleetKeys.staff(fleet.fleetId),
    queryFn: ({ signal }) => fleetApi.staff(fleet.fleetId, signal),
  });
  return (
    <StaffRolesView
      fleet={fleet}
      state={toReadState(staff, online, "staff")}
      online={online}
      onSaved={() =>
        void client.invalidateQueries({
          queryKey: fleetKeys.staff(fleet.fleetId),
        })
      }
      onRetry={() => void staff.refetch()}
    />
  );
};
