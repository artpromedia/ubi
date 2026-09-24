#!/usr/bin/env node
/**
 * Static check of every service/app Dockerfile against the workspace it
 * builds from. Needs only Node (no Docker daemon):
 *
 *   node infrastructure/scripts/check-dockerfiles.mjs            # all
 *   node infrastructure/scripts/check-dockerfiles.mjs ask-service web-app
 *   node infrastructure/scripts/check-dockerfiles.mjs \
 *     --override services/user-service=/tmp/old.Dockerfile       # a variant
 *
 * The build context of every image is the REPOSITORY ROOT
 * (infrastructure/hetzner/docker-compose.prod.yml: `context: ../..`), and the
 * root has no .dockerignore, so an image contains exactly what its Dockerfile
 * names. For a Node package the check derives, from the package manifests:
 *
 *   - the INSTALL closure: every workspace package reachable through any
 *     dependency type, plus the root project's own workspace devDependencies
 *     (a filtered `pnpm install` always includes the root) — each manifest
 *     must be COPYed before `pnpm install --frozen-lockfile --filter "<pkg>..."`;
 *   - the RUNTIME closure: workspace packages reachable through
 *     `dependencies` — each must have its sources and build config copied
 *     into the builder, and its package.json, dist and node_modules copied
 *     into the final stage;
 *
 * and then checks the pnpm/Prisma rules the repository learned the hard way:
 * the Prisma client is generated in the builder and never copied from a root
 * `node_modules/.prisma` (pnpm does not put it there); the production prune
 * pre-confirms the modules purge and skips lifecycle scripts (otherwise the
 * step either silently prunes nothing or fails on the root `prepare`); no
 * whole package directory is copied (it would bring the host's node_modules);
 * the final stage runs as a non-root USER and has a HEALTHCHECK on
 * ${PORT:-default}; every `@ubi/*` import in the package's sources is a
 * declared dependency. Go Dockerfiles are checked for repository-root COPY
 * paths, a Go toolchain at least the module's `go` directive, a non-root user
 * and a HEALTHCHECK.
 *
 * Exit status: 0 when every Dockerfile passes, 1 otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// ---------------------------------------------------------------------------
// Workspace model
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** name -> { dir (repo-relative), manifest } for every workspace package. */
function loadWorkspace() {
  const packages = new Map();
  for (const top of ["apps", "packages", "services", "tooling"]) {
    const base = path.join(ROOT, top);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base)) {
      const manifestPath = path.join(base, entry, "package.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      packages.set(manifest.name, { dir: `${top}/${entry}`, manifest });
    }
  }
  return packages;
}

function workspaceDeps(manifest, types) {
  const out = [];
  for (const type of types) {
    for (const [name, spec] of Object.entries(manifest[type] ?? {})) {
      if (String(spec).startsWith("workspace:")) out.push(name);
    }
  }
  return out;
}

const ALL_TYPES = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function closure(workspace, start, types) {
  const seen = new Set();
  const queue = [...start];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkg = workspace.get(name);
    if (pkg === undefined) continue;
    seen.add(name);
    queue.push(...workspaceDeps(pkg.manifest, types));
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Dockerfile model
// ---------------------------------------------------------------------------

/** Instructions with continuation lines joined and comments dropped. */
function parseDockerfile(text) {
  const instructions = [];
  let pending = "";
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (pending === "" && (line.trim() === "" || line.trim().startsWith("#")))
      continue;
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1)} `;
      continue;
    }
    const full = (pending + line).trim();
    pending = "";
    const match = /^(\S+)\s*(.*)$/.exec(full);
    if (match)
      instructions.push({ op: match[1].toUpperCase(), args: match[2] });
  }
  const stages = [];
  for (const ins of instructions) {
    if (ins.op === "FROM") {
      const name =
        /\bAS\s+(\S+)/i.exec(ins.args)?.[1] ?? `stage${stages.length}`;
      stages.push({ name, from: ins.args.split(/\s+/)[0], instructions: [] });
    } else if (stages.length > 0) {
      stages[stages.length - 1].instructions.push(ins);
    }
  }
  return stages;
}

/** A COPY's flags, sources and destination. */
function parseCopy(args) {
  const parts = args.split(/\s+/).filter(Boolean);
  const flags = {};
  while (parts.length > 0 && parts[0].startsWith("--")) {
    const [key, value] = parts.shift().slice(2).split("=");
    flags[key] = value ?? true;
  }
  const dest = parts.pop();
  return {
    flags,
    sources: parts.map((s) => s.replace(/^\/app\//, "").replace(/^\//, "")),
    dest,
  };
}

function copies(stage, fromStage) {
  return stage.instructions
    .filter((i) => i.op === "COPY")
    .map((i) => parseCopy(i.args))
    .filter((c) =>
      fromStage === undefined
        ? c.flags.from === undefined
        : c.flags.from === fromStage,
    );
}

/** True when some COPY source equals `wanted` or is a glob matching it. */
function copied(copyList, wanted) {
  return copyList.some((c) =>
    c.sources.some((s) => {
      if (s === wanted || s === `${wanted}/`) return true;
      if (!s.includes("*")) return false;
      const re = new RegExp(
        `^${s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`,
      );
      return re.test(wanted);
    }),
  );
}

function runs(stage) {
  return stage.instructions.filter((i) => i.op === "RUN").map((i) => i.args);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Files each workspace package needs in the builder to be BUILT. */
function buildInputs(pkgDir, manifest) {
  const inputs = [];
  const abs = (p) => path.join(ROOT, pkgDir, p);
  if (manifest.name === "@ubi/typescript-config") {
    // Only JSON presets; their manifest is checked with the install closure.
    for (const f of fs.readdirSync(abs(".")))
      if (f.endsWith(".json")) inputs.push(`${pkgDir}/${f}`);
    return inputs;
  }
  if (manifest.name === "@ubi/eslint-config") return inputs; // linked, never built
  if (fs.existsSync(abs("src"))) inputs.push(`${pkgDir}/src`);
  for (const f of [
    "tsconfig.json",
    "tsup.config.ts",
    "prisma.config.ts",
    "next.config.mjs",
    "next.config.js",
    "next-env.d.ts",
    "tailwind.config.ts",
    "postcss.config.js",
    "postcss.config.mjs",
  ]) {
    if (fs.existsSync(abs(f))) inputs.push(`${pkgDir}/${f}`);
  }
  if (fs.existsSync(abs("prisma"))) inputs.push(`${pkgDir}/prisma`);
  const build = manifest.scripts?.build ?? "";
  const codegen = manifest.scripts?.codegen ?? "";
  if (/codegen/.test(build) && fs.existsSync(abs("scripts")))
    inputs.push(`${pkgDir}/scripts`);
  if (
    /state-machines/.test(codegen) ||
    /generate-state-machines/.test(codegen)
  ) {
    inputs.push("contracts/state-machines.json");
  }
  return inputs;
}

function isNextApp(manifest) {
  return /next build/.test(manifest.scripts?.build ?? "");
}

/** `@ubi/*` package names imported by a package's non-test sources. */
function importedWorkspacePackages(pkgDir) {
  const found = new Set();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        ["node_modules", "dist", ".next", "tests", "__tests__"].includes(
          entry.name,
        )
      )
        continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (
        /\.(ts|tsx|mts|js|mjs)$/.test(entry.name) &&
        !/\.(test|spec)\./.test(entry.name)
      ) {
        const src = fs.readFileSync(p, "utf8");
        const re =
          /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](@ubi\/[a-z0-9-]+)/g;
        let m;
        while ((m = re.exec(src)) !== null) {
          // `import type` never reaches runtime.
          const lineStart = src.lastIndexOf("\n", m.index) + 1;
          if (
            /^\s*import\s+type\b|^\s*export\s+type\b/.test(
              src.slice(lineStart, m.index),
            )
          )
            continue;
          found.add(m[1]);
        }
      }
    }
  };
  walk(path.join(ROOT, pkgDir, "src"));
  return found;
}

function checkNode(target, dockerfileText, workspace) {
  const problems = [];
  const { dir, manifest } = target;
  const stages = parseDockerfile(dockerfileText);
  if (stages.length < 2) {
    return [
      `expected a multi-stage build (builder + production), found ${stages.length} stage(s)`,
    ];
  }
  const builder = stages[0];
  const final = stages[stages.length - 1];
  const rootManifest = readJson(path.join(ROOT, "package.json"));

  const install = closure(
    workspace,
    [manifest.name, ...workspaceDeps(rootManifest, ALL_TYPES)],
    ALL_TYPES,
  );
  const runtime = closure(
    workspace,
    workspaceDeps(manifest, ["dependencies"]),
    ["dependencies"],
  );
  const ctxCopies = copies(builder);

  // Workspace configuration + manifests of the install closure.
  for (const f of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"]) {
    if (!copied(ctxCopies, f)) problems.push(`builder does not COPY ${f}`);
  }
  for (const name of install) {
    const pkg = workspace.get(name);
    if (!copied(ctxCopies, `${pkg.dir}/package.json`)) {
      problems.push(
        `builder does not COPY ${pkg.dir}/package.json (${name} is in the install closure)`,
      );
    }
  }

  // The install is the frozen, filtered one.
  const builderRuns = runs(builder);
  const filter = `--filter "${manifest.name}..."`;
  const installRun = builderRuns.find(
    (r) => /pnpm install/.test(r) && !/--prod\b/.test(r),
  );
  if (installRun === undefined) {
    problems.push("builder never runs `pnpm install`");
  } else {
    if (!/--frozen-lockfile/.test(installRun))
      problems.push("the install is not --frozen-lockfile");
    if (!installRun.includes(filter))
      problems.push(`the install does not select ${filter}`);
  }

  // Sources and build configuration of the runtime closure and the package.
  for (const name of [...runtime, "@ubi/typescript-config", manifest.name]) {
    const pkg = workspace.get(name);
    if (pkg === undefined) continue;
    for (const input of buildInputs(pkg.dir, pkg.manifest)) {
      if (!copied(ctxCopies, input))
        problems.push(
          `builder does not COPY ${input} (needed to build ${name})`,
        );
    }
  }

  // No whole-package copies: with no root .dockerignore they drag in the
  // host's node_modules / dist / .turbo.
  for (const c of ctxCopies) {
    for (const s of c.sources) {
      const bare = s.replace(/\/$/, "");
      if (
        [...workspace.values()].some((p) => p.dir === bare) ||
        bare === "." ||
        bare === ""
      ) {
        problems.push(
          `builder copies a whole directory (${s}); name its files instead`,
        );
      }
    }
  }

  // Build + Prisma.
  if (!builderRuns.some((r) => r.includes(filter) && /\brun build\b/.test(r))) {
    problems.push(`builder never runs \`pnpm ${filter} run build\``);
  }
  const needsPrisma = runtime.has("@ubi/database");
  if (needsPrisma && !builderRuns.some((r) => /prisma generate/.test(r))) {
    problems.push(
      "@ubi/database is in the runtime closure but the builder never runs `prisma generate`",
    );
  }
  for (const stage of stages) {
    for (const c of copies(stage).concat(
      stages.flatMap((s) => copies(stage, s.name)),
    )) {
      if (c.sources.some((s) => /(^|\/)node_modules\/\.prisma/.test(s))) {
        problems.push(
          "COPYs a node_modules/.prisma path — under pnpm the client lives in the virtual store",
        );
      }
    }
  }

  // Production prune, when present.
  const prune = builderRuns.find(
    (r) => /pnpm install/.test(r) && /--prod\b/.test(r),
  );
  if (prune !== undefined) {
    if (!/confirmModulesPurge=false/.test(prune)) {
      problems.push(
        "the --prod prune does not pre-confirm the modules purge (without a TTY it prunes nothing)",
      );
    }
    if (!/--ignore-scripts/.test(prune)) {
      problems.push(
        "the --prod prune does not --ignore-scripts (the root `prepare` fails once husky is pruned)",
      );
    }
  }

  // Final stage contents.
  const fromBuilder = copies(final, builder.name);
  if (!copied(fromBuilder, "node_modules"))
    problems.push("final stage does not COPY the builder's root node_modules");
  const shipped = [...runtime].map((n) => workspace.get(n)).filter(Boolean);
  for (const pkg of [...shipped, target]) {
    const outputs =
      pkg === target && isNextApp(manifest)
        ? ["package.json", ".next", "node_modules"]
        : ["package.json", "dist", "node_modules"];
    for (const out of outputs) {
      if (!copied(fromBuilder, `${pkg.dir}/${out}`)) {
        problems.push(
          `final stage does not COPY ${pkg.dir}/${out} from the builder`,
        );
      }
    }
  }
  if (needsPrisma && !copied(fromBuilder, "packages/database/prisma")) {
    problems.push("final stage does not COPY packages/database/prisma");
  }

  // Imports vs. declared dependencies.
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  for (const imported of importedWorkspacePackages(dir)) {
    if (!declared.has(imported)) {
      problems.push(
        `src imports ${imported} at runtime but package.json does not declare it in dependencies`,
      );
    }
  }

  problems.push(...checkRuntimeStage(final));
  return problems;
}

function checkRuntimeStage(final) {
  const problems = [];
  const user = final.instructions.filter((i) => i.op === "USER").pop();
  if (user === undefined || /^(root|0)(:|$)/.test(user.args.trim())) {
    problems.push("final stage does not switch to a non-root USER");
  }
  const health = final.instructions.find((i) => i.op === "HEALTHCHECK");
  if (health === undefined) {
    problems.push("final stage has no HEALTHCHECK");
  } else if (/localhost:\d+/.test(health.args)) {
    problems.push(
      "HEALTHCHECK hardcodes a port; probe ${PORT:-<default>} so it follows the PORT the stack sets",
    );
  }
  return problems;
}

function checkGo(target, dockerfileText) {
  const problems = [];
  const stages = parseDockerfile(dockerfileText);
  const goMod = fs.readFileSync(path.join(ROOT, target.dir, "go.mod"), "utf8");
  const wanted = /^go\s+(\d+)\.(\d+)/m.exec(goMod);
  const builder = stages[0];
  const image = /golang:(\d+)\.(\d+)/.exec(builder?.from ?? "");
  if (wanted && image) {
    const [wMaj, wMin] = [Number(wanted[1]), Number(wanted[2])];
    const [iMaj, iMin] = [Number(image[1]), Number(image[2])];
    if (iMaj < wMaj || (iMaj === wMaj && iMin < wMin)) {
      problems.push(
        `builder image is Go ${iMaj}.${iMin} but go.mod requires ${wMaj}.${wMin}`,
      );
    }
  } else {
    problems.push("builder is not a pinned golang:<major>.<minor> image");
  }
  const ctxCopies = builder ? copies(builder) : [];
  for (const f of ["go.mod", "go.sum"]) {
    if (!copied(ctxCopies, `${target.dir}/${f}`)) {
      problems.push(
        `builder does not COPY ${target.dir}/${f} (the context is the repository root)`,
      );
    }
  }
  for (const c of ctxCopies) {
    for (const s of c.sources) {
      if (!s.startsWith(`${target.dir}/`)) {
        problems.push(
          `builder copies ${s}, which is outside ${target.dir} (the context is the repository root)`,
        );
      }
    }
  }
  if (!copied(ctxCopies, `${target.dir}/cmd`))
    problems.push(`builder does not COPY ${target.dir}/cmd`);
  // cgo-only dependencies cannot build with CGO_ENABLED=0 ("build constraints
  // exclude all Go files"), need a C toolchain in the builder, and link libc
  // dynamically, so the runtime stage must provide one.
  const cgoModule = CGO_ONLY_MODULES.find((m) =>
    new RegExp(`^\\s*${m.replace(/[./]/g, "\\$&")}\\s`, "m").test(goMod),
  );
  if (cgoModule !== undefined && builder) {
    const builderRuns = runs(builder);
    if (builderRuns.some((r) => /CGO_ENABLED=0/.test(r))) {
      problems.push(
        `builds with CGO_ENABLED=0 but go.mod requires ${cgoModule}, a cgo-only binding`,
      );
    }
    if (!builderRuns.some((r) => /\b(build-base|gcc)\b/.test(r))) {
      problems.push(
        `requires ${cgoModule} (cgo) but the builder installs no C toolchain (build-base)`,
      );
    }
    const runtimeFrom = stages[stages.length - 1]?.from ?? "";
    if (/^(scratch|gcr\.io\/distroless\/static)/.test(runtimeFrom)) {
      problems.push(
        `a cgo binary needs a libc at runtime; ${runtimeFrom} has none`,
      );
    }
  }
  if (stages.length > 0)
    problems.push(...checkRuntimeStage(stages[stages.length - 1]));
  return problems;
}

/** Go modules with no pure-Go fallback (they refuse to build without cgo). */
const CGO_ONLY_MODULES = ["github.com/uber/h3-go/v4"];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const overrides = new Map();
  const only = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--override") {
      const [dir, file] = args[i + 1].split("=");
      overrides.set(dir.replace(/\/$/, ""), file);
      i += 1;
    } else {
      only.push(args[i]);
    }
  }

  const workspace = loadWorkspace();
  const targets = [];
  for (const top of ["services", "apps"]) {
    for (const entry of fs.readdirSync(path.join(ROOT, top)).sort()) {
      const dir = `${top}/${entry}`;
      const dockerfile =
        overrides.get(dir) ?? path.join(ROOT, dir, "Dockerfile");
      if (!fs.existsSync(dockerfile)) continue;
      if (only.length > 0 && !only.includes(entry)) continue;
      const manifestPath = path.join(ROOT, dir, "package.json");
      if (fs.existsSync(manifestPath)) {
        targets.push({
          kind: "node",
          dir,
          dockerfile,
          manifest: readJson(manifestPath),
        });
      } else if (fs.existsSync(path.join(ROOT, dir, "go.mod"))) {
        targets.push({ kind: "go", dir, dockerfile });
      }
    }
  }

  let failed = 0;
  for (const target of targets) {
    const text = fs.readFileSync(target.dockerfile, "utf8");
    const problems =
      target.kind === "node"
        ? checkNode(target, text, workspace)
        : checkGo(target, text);
    const label = `${target.dir}/Dockerfile${overrides.has(target.dir) ? ` (override: ${target.dockerfile})` : ""}`;
    if (problems.length === 0) {
      console.log(`PASS  ${label}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${label}`);
      for (const p of [...new Set(problems)]) console.log(`        - ${p}`);
    }
  }
  console.log(
    `\n${targets.length - failed} passed, ${failed} failed (${targets.length} Dockerfiles)`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
