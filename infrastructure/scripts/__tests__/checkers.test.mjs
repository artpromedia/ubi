import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const require = createRequire(path.join(ROOT, "package.json"));
const YAML = require("yaml");

const CHECK_DOCKERFILES = path.join(
  ROOT,
  "infrastructure/scripts/check-dockerfiles.mjs",
);
const CHECK_COMPOSE_ENV = path.join(
  ROOT,
  "infrastructure/scripts/check-compose-env.mjs",
);
const COMPOSE_FILE = path.join(
  ROOT,
  "infrastructure/hetzner/docker-compose.prod.yml",
);
const ENV_EXAMPLE_FILE = path.join(ROOT, "infrastructure/hetzner/.env.example");

function runChecker(script, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      output: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

function withTempFile(prefix, content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ubi-checker-${prefix}-`));
  const file = path.join(dir, "variant");
  fs.writeFileSync(file, content, "utf8");
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("check-dockerfiles.mjs passes all 17 repository Dockerfiles", () => {
  const res = runChecker(CHECK_DOCKERFILES);
  assert.equal(res.status, 0, res.output);
  assert.match(res.output, /17 passed, 0 failed \(17 Dockerfiles\)/);
});

test("check-dockerfiles.mjs negative control: rejects EOL node:20-alpine", () => {
  const original = fs.readFileSync(
    path.join(ROOT, "services/config-service/Dockerfile"),
    "utf8",
  );
  const downgraded = original.replace(
    "FROM node:22-alpine AS builder",
    "FROM node:20-alpine AS builder",
  );
  withTempFile("node20", downgraded, (tmp) => {
    const res = runChecker(CHECK_DOCKERFILES, [
      "config-service",
      "--override",
      `services/config-service=${tmp}`,
    ]);
    assert.equal(res.status, 1, res.output);
    assert.match(res.output, /require node:22-alpine/);
  });
});

test("check-dockerfiles.mjs negative control: rejects filtered pnpm install --prod that leaves root devDependencies", () => {
  const original = fs.readFileSync(
    path.join(ROOT, "services/config-service/Dockerfile"),
    "utf8",
  );
  const unprunedRoot = original.replace(
    "RUN pnpm prune --prod --ignore-scripts --config.confirmModulesPurge=false",
    'RUN pnpm install --prod --frozen-lockfile --offline --ignore-scripts --config.confirmModulesPurge=false --filter "@ubi/config-service..."',
  );
  withTempFile("filtered-prod", unprunedRoot, (tmp) => {
    const res = runChecker(CHECK_DOCKERFILES, [
      "config-service",
      "--override",
      `services/config-service=${tmp}`,
    ]);
    assert.equal(res.status, 1, res.output);
    assert.match(res.output, /leaves root devDependencies/);
  });
});

test("check-dockerfiles.mjs negative control: rejects Next.js image without writable .next/cache", () => {
  const original = fs.readFileSync(
    path.join(ROOT, "apps/web-app/Dockerfile"),
    "utf8",
  );
  const unchowned = original.replace(
    /&& \\\n\s*mkdir -p \/app\/apps\/web-app\/\.next\/cache && \\\n\s*chown -R nodejs:nodejs \/app\/apps\/web-app\/\.next\/cache/,
    "",
  );
  withTempFile("next-cache", unchowned, (tmp) => {
    const res = runChecker(CHECK_DOCKERFILES, [
      "web-app",
      "--override",
      `apps/web-app=${tmp}`,
    ]);
    assert.equal(res.status, 1, res.output);
    assert.match(res.output, /does not chown apps\/web-app\/\.next\/cache/);
  });
});

test("check-compose-env.mjs passes on the Hetzner pilot compose, .env.example, and matrix", () => {
  const res = runChecker(CHECK_COMPOSE_ENV);
  assert.equal(res.status, 0, res.output);
  assert.match(res.output, /85\/85 pooled DB connections/);
});

test("check-compose-env.mjs negative control: rejects Prisma service without connection_limit", () => {
  const original = fs.readFileSync(COMPOSE_FILE, "utf8");
  const unbounded = original.replace(
    "?schema=public&connection_limit=10",
    "?schema=public",
  );
  withTempFile("no-conn-limit", unbounded, (tmp) => {
    const res = runChecker(CHECK_COMPOSE_ENV, ["--compose", tmp]);
    assert.equal(res.status, 1, res.output);
    assert.match(
      res.output,
      /user-service: Prisma service DATABASE_URL must include explicit connection_limit/,
    );
  });
});

test("check-compose-env.mjs negative control: rejects Go service without pool_max_conns", () => {
  const original = fs.readFileSync(COMPOSE_FILE, "utf8");
  const unbounded = original.replace(
    "?sslmode=disable&pool_max_conns=20",
    "?sslmode=disable",
  );
  withTempFile("no-pool-max", unbounded, (tmp) => {
    const res = runChecker(CHECK_COMPOSE_ENV, ["--compose", tmp]);
    assert.equal(res.status, 1, res.output);
    assert.match(
      res.output,
      /ride-service: DATABASE_URL must include explicit pool_max_conns/,
    );
  });
});

test("check-compose-env.mjs negative control: rejects pooled connections exceeding budget 85", () => {
  const original = fs.readFileSync(COMPOSE_FILE, "utf8");
  const overBudget = original.replace(
    "?schema=public&connection_limit=10",
    "?schema=public&connection_limit=20",
  );
  withTempFile("over-budget", overBudget, (tmp) => {
    const res = runChecker(CHECK_COMPOSE_ENV, ["--compose", tmp]);
    assert.equal(res.status, 1, res.output);
    assert.match(
      res.output,
      /pooled Postgres connections sum to 95, exceeding budget 85/,
    );
  });
});

test("check-compose-env.mjs negative control: rejects dead or misspelt .env.example keys", () => {
  const original = fs.readFileSync(ENV_EXAMPLE_FILE, "utf8");
  const withDeadKey = `${original}\nMPESA_SHORTCODE=123456\n`;
  withTempFile("dead-env", withDeadKey, (tmp) => {
    const res = runChecker(CHECK_COMPOSE_ENV, ["--env-example", tmp]);
    assert.equal(res.status, 1, res.output);
    assert.match(
      res.output,
      /env-example: documents MPESA_SHORTCODE, which compose never interpolates/,
    );
  });
});

test("check-compose-env.mjs negative control: rejects composing intentionally excluded location-service", () => {
  const original = fs.readFileSync(COMPOSE_FILE, "utf8");
  const withLocation = original.replace(
    "\nvolumes:\n",
    `\n  location-service:\n    build:\n      context: ../..\n      dockerfile: services/location-service/Dockerfile\n\nvolumes:\n`,
  );
  withTempFile("with-location", withLocation, (tmp) => {
    const res = runChecker(CHECK_COMPOSE_ENV, ["--compose", tmp]);
    assert.equal(res.status, 1, res.output);
    assert.match(res.output, /INTENTIONALLY_UNCOMPOSED_DOCKERFILES/);
  });
});

test("GitHub Actions workflows, k8s overlay, and Caddyfile enforce CC-A07 invariants", () => {
  const workflowsDir = path.join(ROOT, ".github/workflows");
  for (const entry of fs.readdirSync(workflowsDir)) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const text = fs.readFileSync(path.join(workflowsDir, entry), "utf8");
    const parsed = YAML.parse(text, { uniqueKeys: true });
    assert.ok(
      parsed && typeof parsed === "object",
      `${entry} must parse as YAML`,
    );
    if (parsed.env?.NODE_VERSION !== undefined) {
      assert.equal(
        String(parsed.env.NODE_VERSION),
        "22",
        `${entry} NODE_VERSION must be 22`,
      );
    }
  }

  const deployText = fs.readFileSync(
    path.join(workflowsDir, "deploy.yml"),
    "utf8",
  );
  assert.doesNotMatch(deployText, /cd services\/(api-gateway|ride-service)/);
  assert.match(deployText, /docker build -f services\/api-gateway\/Dockerfile/);
  assert.match(
    deployText,
    /docker build -f services\/ride-service\/Dockerfile/,
  );

  const infraText = fs.readFileSync(
    path.join(workflowsDir, "infrastructure.yml"),
    "utf8",
  );
  assert.match(
    infraText,
    /kustomize build infrastructure\/kubernetes\/services\/api-gateway/,
  );
  assert.match(infraText, /check-dockerfiles\.mjs/);
  assert.match(infraText, /check-compose-env\.mjs/);

  const kustomizationText = fs.readFileSync(
    path.join(
      ROOT,
      "infrastructure/kubernetes/services/api-gateway/kustomization.yaml",
    ),
    "utf8",
  );
  YAML.parse(kustomizationText, { uniqueKeys: true });
  assert.doesNotMatch(kustomizationText, /10\.0\.0\.0\/16/);
  assert.match(
    kustomizationText,
    /GATEWAY_TRUSTED_PROXIES=REPLACE_WITH_INGRESS_CIDR/,
  );

  const caddyfile = fs.readFileSync(
    path.join(ROOT, "infrastructure/hetzner/caddy/Caddyfile"),
    "utf8",
  );
  assert.match(
    caddyfile,
    /@blocked not remote_ip \{\$GRAFANA_ALLOWED_IPS:127\.0\.0\.1\/32\}/,
  );
  assert.match(caddyfile, /^\s*respond @blocked "Access denied" 403/m);
});
