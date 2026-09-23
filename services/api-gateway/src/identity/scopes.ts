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
  "mp:request",
  "mp:bid",
  "mp:admin:read",
  "support:write",
  // Ask UBI (ask-service): converse = threads, messages, reading reviews and
  // executions; transact = the explicit confirm that mints a grant and the
  // reconcile that re-drives a confirmed execution.
  "ask:converse",
  "ask:transact",
  // Standing authorisations (user-service /mandates): create, edit, pause,
  // resume, revoke.
  "mandate:manage",
  // Travel (travel-service): read = search supplier inventory and read your
  // own trips, orders, refunds and transfers; book = carts, checkout, cancel
  // and switch (they price, authorize, refund or charge wallet money); ops =
  // the travel-ops exception console.
  "travel:read",
  "travel:book",
  "travel:ops",
  // Business travel (user-service /organizations, payment-service
  // /v1/business): read = your organizations, members, invitations, policy,
  // budgets, funding, bookings and statements; manage = create and administer
  // an organization (members, invitations, cost centres, policy, billing) and
  // accept or decline an invitation; fund = top an organization up from a
  // payment method and move its budget between cost centres. Authority INSIDE
  // an organization (owner / admin / booker) is the service's own membership
  // check; these scopes only decide whether the session may ask.
  "business:read",
  "business:manage",
  "business:fund",
  // Fleet (fleet-service, A05): read = a fleet's calendar, vehicles,
  // conflicts, utilisation and staff; manage = every fleet write (create a
  // fleet, vehicles, staff, maintenance, off-road reports, proposals,
  // swaps, reminders, terminations); driver = the driver's side (fleet
  // offers and PIN signing, the arrangement, the schedule, availability and
  // time off, the driver's own conflicts). Authority INSIDE a fleet (owner /
  // manager / read-only) is fleet-service's own staff check; these scopes
  // only decide whether the session may ask.
  "fleet:read",
  "fleet:manage",
  "fleet:driver",
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
  // Publish, revise, cancel and award negotiated-fare requests (M-series).
  "mp:request",
  "support:write",
  "ask:converse",
  "ask:transact",
  "mandate:manage",
  // Search and book supplier-priced flights and stays (no driver bidding or
  // commission: travel money moves on its own ledger accounts).
  "travel:read",
  "travel:book",
  // Business travel organizations: a traveller, booker, admin or owner is an
  // ordinary rider account (drivers inherit the same).
  "business:read",
  "business:manage",
  "business:fund",
  // Fleet staff (owner / manager / read-only) are ordinary accounts too; a
  // fleet's own staff table decides what each may do inside it.
  "fleet:read",
  "fleet:manage",
];

const DRIVER_SCOPES: readonly Scope[] = [
  ...RIDER_SCOPES,
  "driver:online",
  "driver:documents:write",
  // Bid on marketplace requests and manage rate profiles. Every live bid
  // carries a wallet-held commission reservation.
  "mp:bid",
  // The driver's side of a fleet arrangement: offers, PIN signing, the
  // schedule, availability and time off, the driver's own conflicts.
  "fleet:driver",
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
 *
 * The marketplace scopes (mp:request, mp:bid, mp:admin:read) are DELIBERATELY
 * absent: a bid reserves a wallet commission hold and an award authorizes
 * rider funding, so every /v1/mp route stays off the limited-mode allowlist —
 * the precedent restricts limited mode to cash booking plus reads.
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
  // The assistant's chat and its read-only answers survive limited mode; its
  // confirm (ask:transact), its marketplace stages (mp:request) and standing
  // authorisations (mandate:manage) do not.
  "ask:converse",
  // Searching travel inventory and reading your own trips is a read, like
  // ride:read; carts, checkout, cancel and switch (travel:book) and airport
  // transfers (mp:request) move money and stay off this list.
  "travel:read",
  // The business scopes are DELIBERATELY absent, reads included: an
  // organization's statements and bookings are other people's travel, not
  // the holder's own history, so an unverified device sees none of it
  // (deny-by-default for the new capability).
  //
  // The fleet scopes are DELIBERATELY absent too: a fleet's calendar is other
  // people's work, and every driver-side fleet action commits the driver's
  // time or signs remittance terms (deny-by-default for the new capability).
  //
  // user-service's limited token claim (src/identity/tokens.ts) states this
  // same list; services/api-gateway/tests/limited-token.test.ts pins them
  // together with tokens minted there.
];

/** What wallet safe mode takes away, whatever the role. */
export const SAFE_MODE_DENIED_SCOPES: readonly Scope[] = [
  "wallet:transfer:p2p",
  "wallet:transfer:nip",
  "security:pin:change",
  "security:phone:change",
  "security:contacts:change",
  // Creating or editing a standing authorisation to spend is a security
  // change: not while a SIM-swap signal holds the wallet.
  "mandate:manage",
  // Funding an organization moves money from the holder's payment method to
  // an account other members can spend, the same shape as a P2P transfer:
  // not while a SIM-swap signal holds the wallet. Reading and administering
  // the organization are left alone.
  "business:fund",
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
  // Marketplace (negotiated fares). GET on the request family serves both the
  // owner snapshot/award poll (mp:request) and the driver-view (mp:bid); the
  // downstream engine enforces ownership. Writes on the request family are
  // requester actions only.
  { methods: ["GET"], prefix: "/v1/mp/quote", anyOf: ["mp:request"] },
  {
    methods: ["GET"],
    prefix: "/v1/mp/requests",
    anyOf: ["mp:request", "mp:bid"],
  },
  { methods: ["POST"], prefix: "/v1/mp/requests", anyOf: ["mp:request"] },
  { methods: ["GET"], prefix: "/v1/mp/feed", anyOf: ["mp:bid"] },
  { methods: "*", prefix: "/v1/mp/bids", anyOf: ["mp:bid"] },
  { methods: "*", prefix: "/v1/mp/rate-profiles", anyOf: ["mp:bid"] },
  // Driver-only marketplace surfaces (parked confirmation, job list,
  // preferences). Without this family rule they were undeclared, so any
  // authenticated role reached them and only the downstream role check
  // stood in the way.
  { methods: "*", prefix: "/v1/mp/driver", anyOf: ["mp:bid"] },
  // Book for Later (A03). Scheduled requests, advance requests and recurring
  // templates are requester actions; an advance booking has two parties
  // (the engine enforces which of rider/driver may cancel, rematch,
  // reconfirm or withdraw). The driver calendar rides on /v1/mp/driver.
  { methods: "*", prefix: "/v1/mp/scheduled-requests", anyOf: ["mp:request"] },
  { methods: "*", prefix: "/v1/mp/advance-requests", anyOf: ["mp:request"] },
  { methods: "*", prefix: "/v1/mp/recurring-templates", anyOf: ["mp:request"] },
  // Rider confidence (A06/A04): saved drivers and the service-needs catalog.
  { methods: "*", prefix: "/v1/mp/favourite-drivers", anyOf: ["mp:request"] },
  { methods: ["GET"], prefix: "/v1/mp/service-needs", anyOf: ["mp:request"] },
  {
    methods: "*",
    prefix: "/v1/mp/advance-bookings",
    anyOf: ["mp:request", "mp:bid"],
  },
  { methods: ["GET"], prefix: "/v1/admin/mp", anyOf: ["mp:admin:read"] },
  // Commission-hold ledger endpoints are service-to-service (payment-service
  // verifies the service key); at the gateway only admin/service tokens may
  // even reach them. GET /v1/wallet/mp/overview stays covered by the
  // GET /v1/wallet → wallet:read family rule above.
  { methods: "*", prefix: "/v1/wallet/mp/holds", anyOf: ["admin:all"] },
  { methods: "*", prefix: "/v1/wallets/mp/holds", anyOf: ["admin:all"] },
  { methods: "*", prefix: "/v1/wallet/mp/funding", anyOf: ["admin:all"] },
  { methods: "*", prefix: "/v1/wallets/mp/funding", anyOf: ["admin:all"] },
  // Ask UBI (ask-service). The chat, its reads and handoff need only
  // ask:converse (it survives limited mode). The explicit confirm that mints
  // a grant and the reconcile that re-drives a confirmed execution need
  // ask:transact. The AI marketplace stages sit on the same scope as the
  // human marketplace (/v1/mp): mp:request, off the limited-mode allowlist.
  { methods: "*", prefix: "/v1/ask", anyOf: ["ask:converse"] },
  { methods: ["POST"], prefix: "/v1/ask/reviews", anyOf: ["ask:transact"] },
  {
    methods: ["POST"],
    prefix: "/v1/ask/executions",
    anyOf: ["ask:transact"],
  },
  { methods: "*", prefix: "/v1/ask/mp", anyOf: ["mp:request"] },
  // Mandates (user-service): reading your automations is a profile read;
  // creating, editing, pausing, resuming or revoking one is mandate:manage.
  { methods: ["GET"], prefix: "/v1/mandates", anyOf: ["profile:read"] },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    prefix: "/v1/mandates",
    anyOf: ["mandate:manage"],
  },
  // Travel (travel-service). Searching supplier inventory and reading your
  // own trips, orders, refunds and disruptions are reads (travel:read, kept in
  // limited mode like ride:read). Every other write under /v1/travel moves or
  // commits wallet money — a cart prices a purchase, checkout authorizes the
  // wallet, cancel refunds, switch may charge the difference — so it needs
  // travel:book, off the limited-mode allowlist like every other money-moving
  // route (wallet safe mode leaves booking alone, as it does for rides). The
  // supplier webhooks under /v1/travel/webhooks are not proxied at all
  // (routes/proxy-map.ts).
  { methods: ["GET"], prefix: "/v1/travel", anyOf: ["travel:read"] },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    prefix: "/v1/travel",
    anyOf: ["travel:book"],
  },
  {
    methods: ["POST"],
    prefix: "/v1/travel/flights/searches",
    anyOf: ["travel:read"],
  },
  {
    methods: ["POST"],
    prefix: "/v1/travel/stays/searches",
    anyOf: ["travel:read"],
  },
  // Airport transfers: reading them is travel:read; creating, deciding or
  // cancelling one makes, changes or cancels a marketplace ride request on
  // ride-service, so it needs mp:request exactly as /v1/mp does (travel-
  // service re-checks it on the signed context, since it reaches ride-service
  // without passing this table).
  { methods: ["GET"], prefix: "/v1/reservations", anyOf: ["travel:read"] },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    prefix: "/v1/reservations",
    anyOf: ["mp:request"],
  },
  // The travel-ops console: admin and service tokens only. travel-service
  // re-checks an ops role on the signed context.
  { methods: "*", prefix: "/v1/ops/travel", anyOf: ["travel:ops"] },
  // Business travel. user-service /organizations: reading is business:read,
  // every write (create, members, invitations incl. accept/decline, cost
  // centres, policy, billing) is business:manage. payment-service
  // /v1/business: reading funding, budgets, bookings and statements is
  // business:read; every write there (top-ups, budget allocations and
  // returns) moves organization money and needs business:fund. None of them
  // survives limited mode. payment-service's internal /v1/finance/business
  // (ride-service, by service key) is not proxied at all.
  { methods: ["GET"], prefix: "/v1/organizations", anyOf: ["business:read"] },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    prefix: "/v1/organizations",
    anyOf: ["business:manage"],
  },
  { methods: ["GET"], prefix: "/v1/business", anyOf: ["business:read"] },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    prefix: "/v1/business",
    anyOf: ["business:fund"],
  },
  // Fleet (fleet-service, A05). Reading a fleet is fleet:read; every write
  // under /v1/fleets (create, vehicles, staff, maintenance and its preview,
  // off-road, proposals, swaps, reminders, terminations) is fleet:manage.
  // The driver's side — offers and PIN signing, the arrangement and its
  // notice, the schedule, availability (and its preview) and the driver's
  // own conflicts — is fleet:driver, a DRIVER scope. None survives limited
  // mode. fleet-service re-checks each on the signed context, and its own
  // staff table decides owner / manager / read-only inside a fleet.
  { methods: ["GET"], prefix: "/v1/fleets", anyOf: ["fleet:read"] },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    prefix: "/v1/fleets",
    anyOf: ["fleet:manage"],
  },
  { methods: "*", prefix: "/v1/fleet-offers", anyOf: ["fleet:driver"] },
  {
    methods: "*",
    prefix: "/v1/drivers/me/fleet-offers",
    anyOf: ["fleet:driver"],
  },
  { methods: "*", prefix: "/v1/drivers/me/fleet", anyOf: ["fleet:driver"] },
  {
    methods: "*",
    prefix: "/v1/drivers/me/schedule",
    anyOf: ["fleet:driver"],
  },
  {
    methods: "*",
    prefix: "/v1/drivers/me/availability",
    anyOf: ["fleet:driver"],
  },
  {
    methods: "*",
    prefix: "/v1/drivers/me/availability:preview",
    anyOf: ["fleet:driver"],
  },
  {
    methods: "*",
    prefix: "/v1/drivers/me/conflicts",
    anyOf: ["fleet:driver"],
  },
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
  if (path !== rule.prefix && !path.startsWith(`${rule.prefix}/`)) {
    return false;
  }
  return rule.methods === "*" || rule.methods.includes(method.toUpperCase());
}

/** Longest prefix wins; a method-specific rule beats `"*"` at equal length. */
export function ruleFor(path: string, method: string): RouteRule | undefined {
  let best: RouteRule | undefined;
  for (const rule of ROUTE_RULES) {
    if (!ruleMatches(rule, path, method)) {
      continue;
    }
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
    if (!input.modes.includes("limited")) {
      return;
    }
    throw deniedError(input.modes, {
      path: input.path,
      method: input.method.toUpperCase(),
      reason: "no_scope_declared",
    });
  }

  if (rule.anyOf.some((scope) => input.scopes.includes(scope))) {
    return;
  }

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
