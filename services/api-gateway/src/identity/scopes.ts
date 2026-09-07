/**
 * Scopes, modes and the route → scope table the gateway enforces.
 *
 * Slice 03 defines two restricted modes. Both are decided by the SERVER and
 * travel in the signed identity context; a client can neither set nor clear
 * them:
 *
 *   LIMITED MODE     a new / unverified device. The holder may book with cash
 *                    and read their own history. They may not move money and
 *                    may not change security settings, until a step-up passes.
 *
 *   WALLET SAFE MODE a SIM-swap signal (or another risk signal) put the wallet
 *                    into a time-boxed hold. P2P, NIP and every security change
 *                    (PIN, phone, emergency contacts) are refused for the
 *                    duration. Booking, reading and cash still work.
 *
 * Both can be active at once; the effective scope set is the intersection.
 *
 * The two modes are shaped differently on purpose, because the slice defines
 * them differently:
 *
 *   LIMITED MODE is an ALLOWLIST and therefore DENY BY DEFAULT. A route with
 *   no declared scope requirement is refused, so adding a new proxy prefix can
 *   never silently widen what an unverified device can reach.
 *
 *   WALLET SAFE MODE is a DENYLIST over exactly what the slice names — P2P,
 *   NIP, and PIN / phone / contact changes. A hold placed after a SIM-swap
 *   signal must not lock the holder out of the rest of the product.
 *
 * In full mode the role's scope set governs, and an unlisted route falls
 * through to the downstream service, which still receives the signed context
 * and applies its own authorization.
 */
import { ContractError } from "@ubi/contracts";

export const SCOPES = [
  "profile:read",
  "profile:write",
  "ride:book:cash",
  "ride:book:wallet",
  "ride:read",
  "history:read",
  "order:create",
  "shipment:create",
  "wallet:read",
  "wallet:topup",
  "wallet:transfer:p2p",
  "wallet:transfer:nip",
  "security:pin:change",
  "security:phone:change",
  "security:contacts:change",
  "device:enroll",
  "auth:step_up",
  "driver:online",
  "driver:documents:write",
  "support:write",
  "admin:all",
] as const;

export type Scope = (typeof SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES);

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}

/** Modes are additive restrictions, never grants. */
export const IDENTITY_MODES = ["limited", "wallet_safe"] as const;
export type IdentityMode = (typeof IDENTITY_MODES)[number];

const MODE_SET: ReadonlySet<string> = new Set(IDENTITY_MODES);

export function isIdentityMode(value: string): value is IdentityMode {
  return MODE_SET.has(value);
}

/**
 * What each role may ever hold. The role comes from the validated token, never
 * from a client header, and this table is the ceiling — a token claiming more
 * than its role allows is narrowed to this set.
 */
const RIDER_SCOPES: readonly Scope[] = [
  "profile:read",
  "profile:write",
  "ride:book:cash",
  "ride:book:wallet",
  "ride:read",
  "history:read",
  "order:create",
  "shipment:create",
  "wallet:read",
  "wallet:topup",
  "wallet:transfer:p2p",
  "wallet:transfer:nip",
  "security:pin:change",
  "security:phone:change",
  "security:contacts:change",
  "device:enroll",
  "auth:step_up",
  "support:write",
];

const DRIVER_SCOPES: readonly Scope[] = [
  ...RIDER_SCOPES,
  "driver:online",
  "driver:documents:write",
];

const MERCHANT_SCOPES: readonly Scope[] = [
  "profile:read",
  "profile:write",
  "history:read",
  "wallet:read",
  "wallet:transfer:p2p",
  "wallet:transfer:nip",
  "security:pin:change",
  "security:phone:change",
  "device:enroll",
  "auth:step_up",
  "support:write",
];

export const ROLE_SCOPES: Readonly<Record<string, readonly Scope[]>> = {
  rider: RIDER_SCOPES,
  driver: DRIVER_SCOPES,
  merchant: MERCHANT_SCOPES,
  restaurant: MERCHANT_SCOPES,
  admin: [...SCOPES],
  service: [...SCOPES],
};

/**
 * Everything a limited-mode session keeps: book with cash, view history, read
 * your own profile and wallet balance, and complete the step-up that ends the
 * limitation. Nothing that moves money, nothing that changes security.
 */
export const LIMITED_MODE_SCOPES: readonly Scope[] = [
  "profile:read",
  "ride:book:cash",
  "ride:read",
  "history:read",
  "wallet:read",
  "device:enroll",
  "auth:step_up",
  "support:write",
];

/** What wallet safe mode takes away, whatever the role. */
export const SAFE_MODE_DENIED_SCOPES: readonly Scope[] = [
  "wallet:transfer:p2p",
  "wallet:transfer:nip",
  "security:pin:change",
  "security:phone:change",
  "security:contacts:change",
];

export interface RouteRule {
  /** `"*"` matches every method. */
  readonly methods: readonly string[] | "*";
  /** Path prefix, always including the `/v1` version segment the gateway mounts. */
  readonly prefix: string;
  /** The request is allowed when the session holds ANY of these. */
  readonly anyOf: readonly Scope[];
}

/**
 * Longest matching prefix wins; a method-specific rule beats a `"*"` rule of
 * the same length.
 *
 * `POST /v1/rides` requires `ride:book:cash` OR `ride:book:wallet` because the
 * gateway does not read request bodies. The signed context carries the exact
 * pair it granted, and ride-service refuses a wallet-funded ride when
 * `ride:book:wallet` is absent.
 */
export const ROUTE_RULES: readonly RouteRule[] = [
  { methods: "*", prefix: "/v1/devices", anyOf: ["device:enroll"] },
  { methods: "*", prefix: "/v1/auth/step-up", anyOf: ["auth:step_up"] },
  { methods: "*", prefix: "/v1/auth/pin/reset", anyOf: ["auth:step_up"] },
  { methods: "*", prefix: "/v1/auth/pin", anyOf: ["wallet:read"] },
  { methods: ["GET"], prefix: "/v1/users", anyOf: ["profile:read"] },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    prefix: "/v1/users",
    anyOf: ["profile:write"],
  },
  {
    methods: "*",
    prefix: "/v1/users/me/phone",
    anyOf: ["security:phone:change"],
  },
  {
    methods: "*",
    prefix: "/v1/users/me/contacts",
    anyOf: ["security:contacts:change"],
  },
  { methods: "*", prefix: "/v1/users/me/pin", anyOf: ["security:pin:change"] },
  { methods: ["GET"], prefix: "/v1/rides", anyOf: ["ride:read"] },
  {
    methods: ["POST"],
    prefix: "/v1/rides",
    anyOf: ["ride:book:cash", "ride:book:wallet"],
  },
  {
    methods: "*",
    prefix: "/v1/pricing",
    anyOf: ["ride:book:cash", "ride:book:wallet"],
  },
  { methods: "*", prefix: "/v1/locations", anyOf: ["ride:read"] },
  {
    methods: ["GET"],
    prefix: "/v1/drivers/me/documents",
    anyOf: ["profile:read"],
  },
  {
    methods: ["POST", "PUT", "PATCH"],
    prefix: "/v1/drivers/me/documents",
    anyOf: ["driver:documents:write"],
  },
  { methods: "*", prefix: "/v1/drivers/me/status", anyOf: ["driver:online"] },
  { methods: ["GET"], prefix: "/v1/wallets", anyOf: ["wallet:read"] },
  { methods: ["GET"], prefix: "/v1/wallet", anyOf: ["wallet:read"] },
  { methods: ["GET"], prefix: "/v1/transactions", anyOf: ["history:read"] },
  {
    methods: ["POST"],
    prefix: "/v1/wallets/transfers",
    anyOf: ["wallet:transfer:p2p"],
  },
  {
    methods: ["POST"],
    prefix: "/v1/wallet/transfers",
    anyOf: ["wallet:transfer:p2p"],
  },
  {
    methods: ["POST"],
    prefix: "/v1/wallets/nip",
    anyOf: ["wallet:transfer:nip"],
  },
  {
    methods: ["POST"],
    prefix: "/v1/wallet/nip",
    anyOf: ["wallet:transfer:nip"],
  },
  { methods: ["POST"], prefix: "/v1/wallets/topup", anyOf: ["wallet:topup"] },
  { methods: ["POST"], prefix: "/v1/wallet/topup", anyOf: ["wallet:topup"] },
  {
    methods: ["POST"],
    prefix: "/v1/wallet/pin",
    anyOf: ["security:pin:change"],
  },
  { methods: "*", prefix: "/v1/payments", anyOf: ["wallet:read"] },
  { methods: ["POST"], prefix: "/v1/food", anyOf: ["order:create"] },
  { methods: ["POST"], prefix: "/v1/delivery", anyOf: ["shipment:create"] },
  { methods: ["POST"], prefix: "/v1/packages", anyOf: ["shipment:create"] },
  { methods: "*", prefix: "/v1/support", anyOf: ["support:write"] },
];

export function scopesForRole(role: string): readonly Scope[] {
  return ROLE_SCOPES[role.toLowerCase()] ?? [];
}

export interface EffectiveScopeInput {
  readonly role: string;
  /** Scopes claimed by the server-issued token. They may only NARROW the role. */
  readonly tokenScopes?: readonly string[] | undefined;
  readonly modes: readonly IdentityMode[];
}

/**
 * The scopes this request actually carries.
 *
 * role ceiling ∩ token claim, minus everything each active mode removes. No
 * step in this pipeline can add a scope, so neither a forged claim nor a stale
 * token can widen a session.
 */
export function effectiveScopes(input: EffectiveScopeInput): readonly Scope[] {
  const ceiling = scopesForRole(input.role);
  const claimed = input.tokenScopes;
  let allowed: readonly Scope[] =
    claimed === undefined
      ? ceiling
      : ceiling.filter((scope) => claimed.includes(scope));

  if (input.modes.includes("limited")) {
    allowed = allowed.filter((scope) => LIMITED_MODE_SCOPES.includes(scope));
  }
  if (input.modes.includes("wallet_safe")) {
    allowed = allowed.filter(
      (scope) => !SAFE_MODE_DENIED_SCOPES.includes(scope),
    );
  }
  return allowed;
}

function ruleMatches(rule: RouteRule, path: string, method: string): boolean {
  if (path !== rule.prefix && !path.startsWith(`${rule.prefix}/`)) return false;
  return rule.methods === "*" || rule.methods.includes(method.toUpperCase());
}

/** Longest prefix wins; a method-specific rule beats `"*"` at equal length. */
export function ruleFor(path: string, method: string): RouteRule | undefined {
  let best: RouteRule | undefined;
  for (const rule of ROUTE_RULES) {
    if (!ruleMatches(rule, path, method)) continue;
    if (best === undefined) {
      best = rule;
      continue;
    }
    if (rule.prefix.length > best.prefix.length) {
      best = rule;
      continue;
    }
    if (
      rule.prefix.length === best.prefix.length &&
      best.methods === "*" &&
      rule.methods !== "*"
    ) {
      best = rule;
    }
  }
  return best;
}

export interface AuthorizeInput {
  readonly path: string;
  readonly method: string;
  readonly role: string;
  readonly modes: readonly IdentityMode[];
  readonly scopes: readonly Scope[];
}

/**
 * Decides one request. Throws a `ContractError` carrying the canonical code so
 * the client can tell "you are in safe mode" from "your device is not trusted
 * yet" from a plain permission failure, and never has to read message text.
 */
export function authorizeRequest(input: AuthorizeInput): void {
  const rule = ruleFor(input.path, input.method);

  if (rule === undefined) {
    // Limited mode is an allowlist: an undeclared route is not on it.
    if (!input.modes.includes("limited")) return;
    throw deniedError(input.modes, {
      path: input.path,
      method: input.method.toUpperCase(),
      reason: "no_scope_declared",
    });
  }

  if (rule.anyOf.some((scope) => input.scopes.includes(scope))) return;

  const ceiling = scopesForRole(input.role);
  const grantedByRole = rule.anyOf.filter((scope) => ceiling.includes(scope));
  if (grantedByRole.length === 0) {
    throw new ContractError(
      "forbidden",
      "This action is not available for your account type",
      {
        required: [...rule.anyOf],
      },
    );
  }

  throw deniedError(input.modes, {
    path: input.path,
    method: input.method.toUpperCase(),
    required: grantedByRole,
  });
}

function deniedError(
  modes: readonly IdentityMode[],
  details: Readonly<Record<string, unknown>>,
): ContractError {
  if (modes.includes("wallet_safe")) {
    return new ContractError(
      "safe_mode_active",
      "Your wallet is in safe mode after a SIM-swap signal. Transfers and security changes are paused; call support to lift it early.",
      { ...details, modes: [...modes] },
    );
  }
  if (modes.includes("limited")) {
    return new ContractError(
      "limited_mode",
      "This device is not verified yet. Finish the security check to move money or change security settings.",
      { ...details, modes: [...modes] },
    );
  }
  return new ContractError(
    "forbidden",
    "You don't have permission to perform this action",
    details,
  );
}
