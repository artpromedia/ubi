/**
 * Generates src/state-machines/machines.generated.ts from the canonical
 * contracts/state-machines.json so the code can never drift from the contract.
 *
 * Run: pnpm --filter @ubi/contracts codegen
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const source = join(repoRoot, "contracts", "state-machines.json");
const target = join(here, "..", "src", "state-machines", "machines.generated.ts");

const raw = JSON.parse(readFileSync(source, "utf8"));

const machines = Object.entries(raw).filter(
  ([key, value]) =>
    !key.startsWith("$") && value && typeof value === "object" && "transitions" in value,
);

/**
 * The contract declares some states only as transition *targets*
 * (e.g. rider.cancelled_by_rider, shipment.return_to_sender). They are terminal
 * states, so the generator adds them with an empty transition list rather than
 * silently dropping them from the state union.
 */
const terminalOnly = {};
for (const [name, machine] of machines) {
  const declared = new Set(Object.keys(machine.transitions));
  const targetOnly = new Set();
  for (const targets of Object.values(machine.transitions)) {
    for (const t of targets) if (!declared.has(t)) targetOnly.add(t);
  }
  terminalOnly[name] = [...targetOnly].sort();
  for (const t of terminalOnly[name]) machine.transitions[t] = [];
}

const lines = [];
lines.push("/* eslint-disable */");
lines.push("// GENERATED FILE — do not edit by hand.");
lines.push("// Source: contracts/state-machines.json");
lines.push("// Regenerate: pnpm --filter @ubi/contracts codegen");
lines.push("");

for (const [name, machine] of machines) {
  const states = Object.keys(machine.transitions);
  const constName = name.replace(/([A-Z])/g, "_$1").toUpperCase();

  lines.push(`export const ${constName}_STATES = [`);
  for (const state of states) lines.push(`  ${JSON.stringify(state)},`);
  lines.push("] as const;");
  lines.push(
    `export type ${name[0].toUpperCase()}${name.slice(1)}State = (typeof ${constName}_STATES)[number];`,
  );
  lines.push("");
  lines.push(
    `export const ${constName}_TRANSITIONS: Readonly<Record<${name[0].toUpperCase()}${name.slice(1)}State, readonly ${name[0].toUpperCase()}${name.slice(1)}State[]>> = {`,
  );
  for (const [from, to] of Object.entries(machine.transitions)) {
    lines.push(`  ${JSON.stringify(from)}: [${to.map((t) => JSON.stringify(t)).join(", ")}],`);
  }
  lines.push("};");
  lines.push("");
  lines.push(`export const ${constName}_INITIAL = ${JSON.stringify(machine.initial)} as const;`);
  lines.push("");
}

lines.push("/**");
lines.push(" * States the contract declares only as transition targets. They are terminal.");
lines.push(" * Reported so a contract review can decide whether each is intended to be a leaf.");
lines.push(" */");
lines.push("export const TERMINAL_ONLY_STATES: Readonly<Record<string, readonly string[]>> = {");
for (const [name] of machines) {
  lines.push(`  ${name}: [${terminalOnly[name].map((s) => JSON.stringify(s)).join(", ")}],`);
}
lines.push("};");
lines.push("");
lines.push("export const MACHINE_NAMES = [");
for (const [name] of machines) lines.push(`  ${JSON.stringify(name)},`);
lines.push("] as const;");
lines.push("export type MachineName = (typeof MACHINE_NAMES)[number];");
lines.push("");
lines.push(
  "export const MACHINES: Readonly<Record<MachineName, { readonly initial: string; readonly transitions: Readonly<Record<string, readonly string[]>> }>> = {",
);
for (const [name, machine] of machines) {
  const constName = name.replace(/([A-Z])/g, "_$1").toUpperCase();
  lines.push(`  ${name}: { initial: ${constName}_INITIAL, transitions: ${constName}_TRANSITIONS },`);
}
lines.push("};");
lines.push("");

writeFileSync(target, lines.join("\n"), "utf8");
console.log(`generated ${target} from ${machines.length} machines`);
