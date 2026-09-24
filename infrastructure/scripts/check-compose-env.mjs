#!/usr/bin/env node
/**
 * Environment coverage of the Hetzner pilot stack. Needs Node and the
 * repository's `yaml` devDependency (no Docker daemon):
 *
 *   node infrastructure/scripts/check-compose-env.mjs            # check
 *   node infrastructure/scripts/check-compose-env.mjs --discover # print what
 *                                                                 # each service reads
 *   node infrastructure/scripts/check-compose-env.mjs --compose old.yml \
 *     --env-example old.env.example                               # another revision
 *
 * For every service docker-compose.prod.yml builds from this repository, the
 * check reads the variables the service's code actually reads — for a Node
 * service, the files reachable from src/index.ts (exactly what tsup bundles)
 * plus the runtime workspace packages; for a Go service, the non-test files
 * under cmd/ and internal/ — and compares them with CONTRACT below and with
 * the compose file:
 *
 *   1. every variable the code reads is classified in CONTRACT (a new
 *      `process.env.X` / `getEnv("X")` fails the check until someone decides
 *      whether production sets it);
 *   2. `required` variables are set in compose to a literal or to
 *      `${VAR:?...}` (compose then refuses to start without them);
 *      `set` variables are present; `unset` / `dev` variables are ABSENT
 *      (deliberately unconfigured: fail-closed, deny-by-default or dev-only);
 *   3. every variable compose sets for the service is one the code reads, or
 *      is classified `unread` (so a misspelt or dead name cannot hide);
 *   4. every `${VAR}` compose interpolates is documented in .env.example
 *      (or carries a default);
 *   5. every classified variable is named in docs/ops/DEPLOY_ENV_MATRIX.md;
 *   6. every `build.dockerfile` compose references exists.
 *
 * Discovery covers the direct forms (`process.env.X`, `process.env["X"]`,
 * `os.Getenv("X")`, `getEnv("X", ...)`, ...), `*_ENV = "X"` name constants and
 * the env helpers the services use (`readSecret("X")`, `usableKey(env, "X")`,
 * ...). A name built at runtime (`process.env[\`MOMO_${country}_KEY\`]`) is
 * invisible to it; such families are listed in CONTRACT by hand.
 *
 * Exit status: 0 when every check passes, 1 otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const HETZNER = path.join(ROOT, "infrastructure/hetzner");
function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : path.resolve(process.argv[i + 1]);
}
// --compose / --env-example check another revision of the files (e.g. one
// extracted with `git show`); relative build contexts still resolve against
// infrastructure/hetzner/.
const COMPOSE = argValue(
  "--compose",
  path.join(HETZNER, "docker-compose.prod.yml"),
);
const ENV_EXAMPLE = argValue(
  "--env-example",
  path.join(HETZNER, ".env.example"),
);
const MATRIX = path.join(ROOT, "docs/ops/DEPLOY_ENV_MATRIX.md");

const require = createRequire(path.join(ROOT, "package.json"));

// ---------------------------------------------------------------------------
// CONTRACT: service -> variable -> classification.
//   required  set in compose, literal or ${VAR:?} (the service fails closed or
//             refuses to boot without it)
//   set       set in compose (a URL, an address list, an interval — a default
//             is fine)
//   optional  may be set (`${VAR:-}`); empty or absent is a safe default or a
//             closed surface
//   unset     must NOT be in compose: deliberately unconfigured (a
//             deny-by-default switch, a development bypass, a capability with
//             no backend on this host)
//   dev       development / test only; must NOT be in compose
//   unread    set in compose for compatibility; the code does not read it
// Keep in step with docs/ops/DEPLOY_ENV_MATRIX.md (check 5 enforces names).
// ---------------------------------------------------------------------------
const NODE_COMMON = {
  NODE_ENV: "required",
  PORT: "set",
  LOG_LEVEL: "set",
  DATABASE_URL: "required",
  REDIS_URL: "required",
  npm_package_version: "dev",
};

const GO_COMMON = {
  UBI_ENV: "required",
  ENVIRONMENT: "unread",
  PORT: "set",
  LOG_LEVEL: "unread",
  DATABASE_URL: "required",
  REDIS_URL: "required",
};

export const CONTRACT = {
  "api-gateway": {
    ...NODE_COMMON,
    DATABASE_URL: "unread",
    JWT_SECRET: "required",
    JWT_REFRESH_SECRET: "unread",
    CORS_ORIGINS: "unread",
    UBI_IDENTITY_SECRET: "required",
    UBI_IDENTITY_SECRET_PREVIOUS: "optional",
    UBI_IDENTITY_KEY_ID: "optional",
    UBI_IDENTITY_KEY_ID_PREVIOUS: "optional",
    RIDE_INTERNAL_CONTEXT_SECRET: "required",
    GATEWAY_TRUSTED_PROXIES: "set",
    PROXY_TIMEOUT: "optional",
    VALID_SERVICE_API_KEYS: "unset",
    USER_SERVICE_URL: "set",
    RIDE_SERVICE_URL: "set",
    FOOD_SERVICE_URL: "set",
    DELIVERY_SERVICE_URL: "set",
    PAYMENT_SERVICE_URL: "set",
    NOTIFICATION_SERVICE_URL: "set",
    ASK_SERVICE_URL: "set",
    TRAVEL_SERVICE_URL: "set",
    FLEET_SERVICE_URL: "set",
    ANALYTICS_SERVICE_URL: "unset",
    CEERION_SERVICE_URL: "unset",
  },
  "user-service": {
    ...NODE_COMMON,
    JWT_SECRET: "required",
    UBI_IDENTITY_SECRET: "required",
    UBI_IDENTITY_SECRET_PREVIOUS: "optional",
    CONFIG_SERVICE_URL: "set",
    NOTIFICATION_SERVICE_URL: "set",
    SERVICE_API_KEY: "unset",
    APP_URL: "set",
    DRIVER_PROFILE_RIDE_SERVICE_KEY: "required",
    DRIVER_PROFILE_ASK_SERVICE_KEY: "unset",
    AI_GRANTS_SERVICE_KEY: "required",
    AI_GRANT_TTL_SECONDS: "optional",
    IDENTITY_OTP_PEPPER: "optional",
    IDENTITY_JOB_SERVICE_KEY: "optional",
    TELCO_SIM_SWAP_SECRET: "optional",
    IDENTITY_FACE_PROVIDER_URL: "optional",
    IDENTITY_FACE_PROVIDER_KEY: "optional",
    IDENTITY_DEFAULT_CITY_ID: "unset",
  },
  "ride-service": {
    ...GO_COMMON,
    NODE_ENV: "unset",
    RIDE_INTERNAL_CONTEXT_SECRET: "required",
    RIDE_INTERNAL_CONTEXT_MAX_AGE_MS: "optional",
    RIDE_ALLOW_UNSIGNED_IDENTITY: "unset",
    RIDE_QUOTE_SIGNING_SECRET: "required",
    RIDE_PIN_VAULT_SECRET: "required",
    INTERNAL_SERVICE_KEY: "required",
    RIDE_TRUSTED_PROXIES: "set",
    PAYMENT_SERVICE_URL: "set",
    USER_SERVICE_URL: "set",
    DRIVER_PROFILE_RIDE_SERVICE_KEY: "required",
    DELIVERY_SERVICE_URL: "set",
    DELIVERY_SERVICE_KEY: "required",
    TRIP_ACCESS_DELIVERY_KEY: "optional",
    TRIP_ACCESS_DELIVERY_KID: "optional",
    FLEET_RIDE_SERVICE_KEY: "required",
    FLEET_SERVICE_URL: "set",
    FLEET_SERVICE_KEY: "required",
    GOOGLE_MAPS_API_KEY: "optional",
    MAPBOX_ACCESS_TOKEN: "optional",
    OSRM_BASE_URL: "optional",
    RIDE_MIGRATE_ON_BOOT: "unset",
    RIDE_DISPATCH_INTERVAL_MS: "optional",
    RIDE_CONFIG_CACHE_TTL_MS: "optional",
    RIDE_SHUTDOWN_TIMEOUT_MS: "optional",
    RIDE_MP_SWEEP_INTERVAL_MS: "set",
  },
  "food-service": {
    ...NODE_COMMON,
    JWT_SECRET: "required",
    INTERNAL_SERVICE_KEY: "required",
    PAYMENT_SERVICE_URL: "set",
    BITES_ISSUE_SWEEP_INTERVAL_MS: "set",
    SERVICE_VERSION: "optional",
  },
  "delivery-service": {
    ...GO_COMMON,
    ENV: "unset",
    SERVICE_VERSION: "optional",
    RIDE_INTERNAL_CONTEXT_SECRET: "required",
    RIDE_ALLOW_UNSIGNED_IDENTITY: "unset",
    INTERNAL_SERVICE_KEY: "required",
    JWT_SECRET: "required",
    DELIVERY_TRUSTED_PROXIES: "set",
    PAYMENT_SERVICE_URL: "set",
    USER_SERVICE_URL: "set",
    NOTIFICATION_SERVICE_URL: "set",
    PROOF_STORAGE_ENDPOINT: "set",
    PROOF_STORAGE_PUBLIC_ENDPOINT: "set",
    PROOF_STORAGE_REGION: "set",
    PROOF_STORAGE_BUCKET: "set",
    PROOF_STORAGE_ACCESS_KEY: "optional",
    PROOF_STORAGE_SECRET_KEY: "optional",
    PROOF_UPLOAD_URL_TTL: "optional",
    PROOF_DOWNLOAD_URL_TTL: "optional",
    DELIVERY_CHARGED_RETURNS_ENABLED: "unset",
  },
  "payment-service": {
    ...NODE_COMMON,
    UBI_IDENTITY_SECRET: "required",
    UBI_IDENTITY_SECRET_PREVIOUS: "optional",
    INTERNAL_SERVICE_KEY: "required",
    PAYMENT_TRUSTED_PROXIES: "set",
    FLEET_SERVICE_URL: "set",
    FLEET_PAYMENT_SERVICE_KEY: "required",
    FLEET_SETTLEMENT_SWEEP_INTERVAL_MS: "set",
    BUSINESS_PAYOUT_SWEEP_INTERVAL_MS: "set",
    NOTIFICATION_SERVICE_URL: "set",
    NOTIFICATION_SERVICE_API_KEY: "unset",
    // Canonical ledger rails, read as `${prefix}_BASE_URL` / `_API_KEY`.
    NIP_BASE_URL: "optional",
    NIP_API_KEY: "optional",
    NIP_WEBHOOK_SECRET: "optional",
    TOPUP_BASE_URL: "optional",
    TOPUP_API_KEY: "optional",
    // Provider credentials reachable from src/index.ts (payouts, admin).
    PAYSTACK_SECRET_KEY: "optional",
    PAYSTACK_PUBLIC_KEY: "optional",
    PAYSTACK_WEBHOOK_SECRET: "optional",
    PAYSTACK_ENVIRONMENT: "optional",
    MPESA_CONSUMER_KEY: "optional",
    MPESA_CONSUMER_SECRET: "optional",
    MPESA_ENVIRONMENT: "optional",
    MPESA_PASSKEY: "optional",
    MPESA_SHORT_CODE: "optional",
    MPESA_CALLBACK_URL: "optional",
    MPESA_B2C_SHORT_CODE: "optional",
    MPESA_B2C_INITIATOR_NAME: "optional",
    MPESA_B2C_SECURITY_CREDENTIAL: "optional",
    MPESA_B2C_QUEUE_TIMEOUT_URL: "optional",
    MPESA_B2C_RESULT_URL: "optional",
    MOMO_ENVIRONMENT: "optional",
    MOMO_CALLBACK_URL: "optional",
    // In compose since before round 9; no reachable code reads it.
    STRIPE_SECRET_KEY: "unread",
    // Product analytics: off in the pilot.
    ANALYTICS_ENABLED: "unset",
    POSTHOG_API_KEY: "unset",
    POSTHOG_HOST: "unset",
    SEGMENT_WRITE_KEY: "unset",
    SLOW_QUERY_THRESHOLD_MS: "optional",
  },
  "notification-service": {
    ...NODE_COMMON,
    JWT_SECRET: "required",
    INTERNAL_SERVICE_KEY: "required",
    NOTIFICATION_TRUSTED_PROXIES: "set",
    TRIP_ACCESS_DELIVERY_KEY: "optional",
    TRIP_ACCESS_DELIVERY_KID: "optional",
    TRIP_ACCESS_DELIVERY_KEY_PREVIOUS: "optional",
    TRIP_ACCESS_DELIVERY_KID_PREVIOUS: "optional",
    PASSENGER_TRIP_LINK_BASE_URL: "set",
    APP_URL: "set",
    APP_DEEP_LINK_SCHEME: "optional",
    FIREBASE_PROJECT_ID: "optional",
    FIREBASE_SERVICE_ACCOUNT: "optional",
    TWILIO_ACCOUNT_SID: "optional",
    TWILIO_AUTH_TOKEN: "optional",
    TWILIO_FROM_NUMBER: "optional",
    AFRICASTALKING_API_KEY: "optional",
    AFRICASTALKING_USERNAME: "optional",
    AFRICASTALKING_ENV: "optional",
    SENDGRID_API_KEY: "optional",
    SENDGRID_FROM_EMAIL: "optional",
    SENDGRID_FROM_NAME: "optional",
    SENDGRID_VERIFICATION_TEMPLATE_ID: "optional",
    SENDGRID_PASSWORD_RESET_TEMPLATE_ID: "optional",
    SENDGRID_RECEIPT_TEMPLATE_ID: "optional",
    SENDGRID_WELCOME_TEMPLATE_ID: "optional",
    NOTIFY_TEST_REDIS_URL: "dev",
  },
  "config-service": {
    ...NODE_COMMON,
    INTERNAL_SERVICE_KEY: "required",
    CONFIG_CACHE_TTL_SEC: "optional",
    CONFIG_SEED_ENABLED: "unset",
    MARKETING_REVALIDATE_URL: "optional",
    MARKETING_REVALIDATE_SECRET: "optional",
  },
  "ask-service": {
    ...NODE_COMMON,
    UBI_IDENTITY_SECRET: "required",
    UBI_IDENTITY_SECRET_PREVIOUS: "optional",
    RIDE_INTERNAL_CONTEXT_SECRET: "required",
    INTERNAL_SERVICE_KEY: "required",
    AI_GRANTS_SERVICE_KEY: "required",
    TRAVEL_ASK_SERVICE_KEY: "required",
    USER_SERVICE_URL: "set",
    RIDE_SERVICE_URL: "set",
    TRAVEL_SERVICE_URL: "set",
    SUPPORT_SERVICE_URL: "set",
    PROMOTIONS_SERVICE_URL: "unset",
    MODEL_ENDPOINT_URL: "unset",
    MODEL_NAME: "unset",
    MODEL_REVISION: "unset",
    MODEL_API_KEY: "unset",
    MODEL_SERVED_ID: "unset",
    MODEL_WEIGHTS_REVISION: "unset",
    MODEL_TOKENIZER_REVISION: "unset",
    MODEL_SERVING_IMAGE: "unset",
    MODEL_TOOL_PARSER: "unset",
    MODEL_ATTESTATION_URL: "unset",
    MODEL_ATTESTATION_MODE: "unset",
    EMBED_ENDPOINT_URL: "unset",
    EMBED_NAME: "unset",
    EMBED_REVISION: "unset",
  },
  "travel-service": {
    ...NODE_COMMON,
    UBI_ENV: "optional",
    UBI_IDENTITY_SECRET: "required",
    UBI_IDENTITY_SECRET_PREVIOUS: "optional",
    RIDE_INTERNAL_CONTEXT_SECRET: "required",
    INTERNAL_SERVICE_KEY: "required",
    TRAVEL_ASK_SERVICE_KEY: "required",
    PAYMENT_SERVICE_URL: "set",
    PAYMENT_TRAVEL_PATH: "unset",
    RIDE_SERVICE_URL: "set",
    TRANSFER_SWEEP_INTERVAL_MS: "set",
  },
  "fleet-service": {
    ...NODE_COMMON,
    UBI_IDENTITY_SECRET: "required",
    UBI_IDENTITY_SECRET_PREVIOUS: "optional",
    FLEET_SERVICE_KEY: "required",
    FLEET_PAYMENT_SERVICE_KEY: "required",
    FLEET_RIDE_SERVICE_KEY: "required",
    RIDE_SERVICE_URL: "set",
    USER_SERVICE_URL: "set",
  },
  "growth-service": {
    ...NODE_COMMON,
    INTERNAL_SERVICE_KEY: "required",
    PAYMENT_SERVICE_URL: "set",
    REFERRAL_URL_BASE: "set",
    MARKETING_MODEL: "optional",
    MARKETING_PROMPT_VERSION: "optional",
  },
  "support-service": {
    ...NODE_COMMON,
    INTERNAL_SERVICE_KEY: "required",
    PAYMENT_SERVICE_URL: "set",
    NOTIFICATION_SERVICE_URL: "set",
    LEDGER_REMEDY_PATH: "unset",
    SOS_SWEEP_INTERVAL_MS: "set",
  },
  "realtime-gateway": {
    ...NODE_COMMON,
    DATABASE_URL: "unset",
    JWT_SECRET: "required",
    INTERNAL_SERVICE_KEY: "required",
    SERVICE_SECRET: "unset",
  },
  // NEXT_PUBLIC_* are inlined into the bundle at `next build`: compose passes
  // NEXT_PUBLIC_API_URL as a build argument AND at runtime; the analytics keys
  // stay empty (no analytics in the pilot) and APP_URL has a code default.
  "web-app": {
    NODE_ENV: "required",
    NEXT_PUBLIC_API_URL: "set",
    NEXT_PUBLIC_APP_URL: "optional",
    NEXT_PUBLIC_GA_MEASUREMENT_ID: "unset",
    NEXT_PUBLIC_MIXPANEL_TOKEN: "unset",
    NEXT_PUBLIC_AMPLITUDE_API_KEY: "unset",
    NEXT_PUBLIC_POSTHOG_KEY: "unset",
    NEXT_PUBLIC_POSTHOG_HOST: "unset",
  },
  "admin-dashboard": {
    NODE_ENV: "required",
    NEXT_PUBLIC_API_URL: "set",
  },
};

/** Names the code builds at runtime (invisible to discovery), documented here. */
const DYNAMIC_FAMILIES = {
  "travel-service": ["TRAVEL_SECRET_<REF>"],
  "payment-service": ["MOMO_<COUNTRY>_*"],
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const NAME = "[A-Z][A-Z0-9_]*[A-Z0-9]|npm_package_version";
const NODE_PATTERNS = [
  new RegExp(`process\\.env\\.(${NAME})\\b`, "g"),
  new RegExp(`process\\.env\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
  new RegExp(`\\benv\\.(${NAME})\\b`, "g"),
  new RegExp(`\\benv\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
  new RegExp(`\\b[A-Z0-9_]*_ENV\\s*=\\s*["'](${NAME})["']`, "g"),
  new RegExp(
    `\\b(?:readSecret|intervalFrom|usableKey|envValue|readInt|readEnv|requireEnv|optionalEnv)\\([^)]*?["'](${NAME})["']`,
    "g",
  ),
];
const GO_PATTERNS = [
  new RegExp(
    `\\b(?:os\\.Getenv|os\\.LookupEnv|getEnv|getDuration|getInt|getBool)\\(\\s*"(${NAME})"`,
    "g",
  ),
  new RegExp(`\\b[eE]nv[A-Za-z0-9]*\\s*=\\s*"(${NAME})"`, "g"),
];

/** Comments name variables in prose (`createConfigClient({ baseUrl: process.env.X })`). */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function scan(text, patterns, into) {
  text = stripComments(text);
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) into.add(m[1]);
  }
}

/** Files reachable from `entry` through relative imports (what tsup bundles). */
function reachable(entry) {
  const seen = new Set();
  const queue = [entry];
  const resolve = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec.replace(/\.js$/, ""));
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
        return candidate;
    }
    return null;
  };
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    const re =
      /(?:import|export)\s[^;]*?from\s*["'](\.[^"']+)["']|import\s*\(\s*["'](\.[^"']+)["']\s*\)|import\s+["'](\.[^"']+)["']/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const target = resolve(file, m[1] ?? m[2] ?? m[3]);
      if (target !== null) queue.push(target);
    }
  }
  return seen;
}

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ["node_modules", "dist", "testutil", "tests", "__tests__"].includes(
        entry.name,
      )
    )
      continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, filter, out);
    else if (filter(entry.name)) out.push(p);
  }
  return out;
}

function runtimeWorkspacePackages(manifest) {
  const out = new Set();
  const queue = Object.entries(manifest.dependencies ?? {})
    .filter(([, v]) => String(v).startsWith("workspace:"))
    .map(([k]) => k);
  while (queue.length > 0) {
    const name = queue.shift();
    if (out.has(name)) continue;
    const dir = path.join(ROOT, "packages", name.replace("@ubi/", ""));
    const pj = path.join(dir, "package.json");
    if (!fs.existsSync(pj)) continue;
    out.add(name);
    const m = JSON.parse(fs.readFileSync(pj, "utf8"));
    for (const [k, v] of Object.entries(m.dependencies ?? {})) {
      if (String(v).startsWith("workspace:")) queue.push(k);
    }
  }
  return out;
}

/** The variables a service's shipped code reads. */
export function discover(dir) {
  const abs = path.join(ROOT, dir);
  const found = new Set();
  if (fs.existsSync(path.join(abs, "go.mod"))) {
    for (const f of [
      ...walk(
        path.join(abs, "cmd"),
        (n) => n.endsWith(".go") && !n.endsWith("_test.go"),
      ),
      ...walk(
        path.join(abs, "internal"),
        (n) => n.endsWith(".go") && !n.endsWith("_test.go"),
      ),
    ]) {
      scan(fs.readFileSync(f, "utf8"), GO_PATTERNS, found);
    }
    return found;
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(abs, "package.json"), "utf8"),
  );
  const entry = path.join(abs, "src/index.ts");
  const files = fs.existsSync(entry)
    ? [...reachable(entry)]
    : walk(
        path.join(abs, "src"),
        (n) => /\.(ts|tsx)$/.test(n) && !/\.(test|spec)\./.test(n),
      );
  for (const name of runtimeWorkspacePackages(manifest)) {
    const pkgSrc = path.join(
      ROOT,
      "packages",
      name.replace("@ubi/", ""),
      "src",
    );
    files.push(
      ...walk(pkgSrc, (n) => /\.ts$/.test(n) && !/\.(test|spec)\./.test(n)),
    );
  }
  for (const f of files) scan(fs.readFileSync(f, "utf8"), NODE_PATTERNS, found);
  return found;
}

// ---------------------------------------------------------------------------
// Compose model
// ---------------------------------------------------------------------------

function loadYaml(file) {
  let YAML;
  try {
    YAML = require("yaml");
  } catch {
    console.error(
      "the `yaml` package is not installed: run `pnpm install` at the repository root",
    );
    process.exit(2);
  }
  return YAML.parse(fs.readFileSync(file, "utf8"));
}

function environmentOf(service) {
  const env = service.environment ?? {};
  if (Array.isArray(env)) {
    return Object.fromEntries(
      env.map((line) => {
        const i = line.indexOf("=");
        return i === -1 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)];
      }),
    );
  }
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === null ? "" : String(v)]),
  );
}

/**
 * How firmly compose sets a value. A plain `${VAR}` counts as enforced when the
 * same file requires VAR somewhere with `${VAR:?...}` (compose interpolates
 * the whole file, so it refuses to start without it either way) — e.g.
 * POSTGRES_PASSWORD inside every DATABASE_URL.
 */
function composeStrength(value, enforced) {
  const refs = [...value.matchAll(/\$\{([A-Z0-9_]+)(:?[-?])?([^}]*)\}/g)];
  if (refs.length === 0) return value.length > 0 ? "literal" : "empty";
  const strong = (r) =>
    r[2] === ":?" ||
    (r[2] === ":-" && r[3] !== "") ||
    (r[2] === undefined && enforced.has(r[1]));
  const only = refs.length === 1 && refs[0][0] === value ? refs[0] : null;
  if (only !== null) {
    if (only[2] === ":-" && only[3] === "") return "optional-empty";
    if (only[2] === ":-") return "defaulted";
    return strong(only) ? "required" : "plain-ref";
  }
  return refs.every(strong) ? "templated" : "templated-weak";
}

function envExampleKeys() {
  const keys = new Set();
  for (const line of fs.readFileSync(ENV_EXAMPLE, "utf8").split("\n")) {
    const m = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sourceDirOf(name, service) {
  const dockerfile = service.build?.dockerfile;
  if (typeof dockerfile !== "string" || !/^(services|apps)\//.test(dockerfile))
    return null;
  return path.dirname(dockerfile);
}

function main() {
  const discoverOnly = process.argv.includes("--discover");
  const compose = loadYaml(COMPOSE);
  const composeText = fs.readFileSync(COMPOSE, "utf8");
  const enforced = new Set(
    [...composeText.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((m) => m[1]),
  );
  const problems = [];
  const fail = (svc, msg) => problems.push(`${svc}: ${msg}`);

  // 6. Dockerfiles exist.
  for (const [name, service] of Object.entries(compose.services)) {
    if (service.build === undefined) continue;
    const context = path.resolve(HETZNER, service.build.context ?? ".");
    const dockerfile = path.resolve(
      context,
      service.build.dockerfile ?? "Dockerfile",
    );
    if (!fs.existsSync(dockerfile))
      fail(
        name,
        `build.dockerfile ${path.relative(ROOT, dockerfile)} does not exist`,
      );
  }

  for (const [name, service] of Object.entries(compose.services)) {
    const dir = sourceDirOf(name, service);
    if (dir === null) continue;
    const read = discover(dir);
    const composeEnv = environmentOf(service);
    if (discoverOnly) {
      console.log(`${name} (${dir}) reads: ${[...read].sort().join(" ")}`);
      console.log(
        `${name} compose sets: ${Object.keys(composeEnv).sort().join(" ")}`,
      );
      continue;
    }
    const contract = CONTRACT[name];
    if (contract === undefined) {
      fail(
        name,
        "no CONTRACT entry: classify every variable this service reads",
      );
      continue;
    }
    // 1. Every read variable is classified.
    for (const v of read) {
      if (contract[v] === undefined)
        fail(name, `reads ${v}, which CONTRACT does not classify`);
    }
    // 2. Classification vs compose.
    for (const [v, cls] of Object.entries(contract)) {
      const present = Object.prototype.hasOwnProperty.call(composeEnv, v);
      const strength = present
        ? composeStrength(composeEnv[v], enforced)
        : "absent";
      if (
        cls === "required" &&
        !["required", "literal", "templated"].includes(strength)
      ) {
        fail(
          name,
          `${v} is required but compose sets it as ${strength} (use a literal or \${${v}:?...})`,
        );
      }
      if (
        cls === "set" &&
        (strength === "absent" ||
          strength === "empty" ||
          strength === "optional-empty")
      ) {
        fail(name, `${v} must be set in compose (found: ${strength})`);
      }
      if ((cls === "unset" || cls === "dev") && present) {
        fail(name, `${v} is classified ${cls} and must not be set in compose`);
      }
    }
    // 3. Compose sets nothing unknown.
    for (const v of Object.keys(composeEnv)) {
      if (contract[v] === undefined)
        fail(
          name,
          `compose sets ${v}, which the service never reads (and CONTRACT does not list as unread)`,
        );
    }
  }

  if (!discoverOnly) {
    // 4. Interpolations documented.
    const documented = envExampleKeys();
    for (const m of composeText.matchAll(
      /\$\{([A-Z0-9_]+)(:?[-?])?([^}]*)\}/g,
    )) {
      const [, v, op, rest] = m;
      const hasDefault = op === ":-" && rest !== "";
      if (!documented.has(v) && !hasDefault)
        fail(
          "compose",
          `interpolates \${${v}} with no default and .env.example does not document it`,
        );
    }
    // 5. The matrix names every classified variable.
    const matrix = fs.existsSync(MATRIX) ? fs.readFileSync(MATRIX, "utf8") : "";
    const names = new Set(
      Object.values(CONTRACT).flatMap((c) => Object.keys(c)),
    );
    for (const fam of Object.values(DYNAMIC_FAMILIES).flat()) names.add(fam);
    for (const v of names) {
      if (!matrix.includes(`\`${v}\``))
        fail("matrix", `docs/ops/DEPLOY_ENV_MATRIX.md does not name \`${v}\``);
    }
  }

  if (discoverOnly) return;
  const unique = [...new Set(problems)];
  if (unique.length === 0) {
    const services = Object.keys(CONTRACT).length;
    const vars = new Set(Object.values(CONTRACT).flatMap((c) => Object.keys(c)))
      .size;
    console.log(
      `PASS  ${services} services, ${vars} classified variables, compose + .env.example + matrix consistent`,
    );
    process.exit(0);
  }
  for (const p of unique) console.log(`FAIL  ${p}`);
  console.log(`\n${unique.length} problem(s)`);
  process.exit(1);
}

main();
