import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpsCreditsView } from "../../components/payments/OpsCreditsView";
import {
  canManageOpsCredits,
  evaluateApproveEligibility,
  majorUnitsToMinor,
  opsCreditsApi,
  type CityOpsCreditConfigView,
  type OpsCreditView,
} from "../ops-credits-api";
import { isAdminConsoleRole, type PublicAdminSession } from "../session";

const cityConfig: CityOpsCreditConfigView = {
  cityId: "LOS",
  version: 2,
  currency: "NGN",
  currencyFractionDigits: 2,
  opsCreditPolicy: {
    maxPerCreditMinor: 2_500_000,
    maxDriverDailyMinor: 5_000_000,
    maxCityDailyMinor: 100_000_000,
    reasonCodes: [
      "pilot_onboarding_float",
      "bank_deposit_verified",
      "goodwill_adjustment",
      "settlement_reconciliation",
    ],
  },
};

function makeOperator(
  overrides: Partial<PublicAdminSession["user"]> = {},
  mode: "full" | "limited" = "full",
): PublicAdminSession {
  return {
    user: {
      id: "usr_fin_01",
      phone: "+2348011112222",
      email: "finance1@ubi.africa",
      firstName: "Chidi",
      lastName: "Nwosu",
      role: "finance_ops",
      homeCityId: "LOS",
      ...overrides,
    },
    mode,
    expiresAt: 1_750_000_000_000,
    stepUp: null,
  };
}

function makeCredit(overrides: Partial<OpsCreditView> = {}): OpsCreditView {
  return {
    id: "ocrd_01",
    cityId: "LOS",
    driverUserId: "usr_driver_01",
    walletId: "wal_driver_01",
    amount: { amountMinor: 500_000, currency: "NGN" },
    reasonCode: "bank_deposit_verified",
    note: "Verified deposit slip",
    reference: "BNK-9912",
    status: "pending_approval",
    createdBy: "usr_fin_01",
    createdByRole: "finance_ops",
    approvedBy: null,
    approvedByRole: null,
    approvalNote: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedByRole: null,
    rejectedAt: null,
    rejectionReason: null,
    reversedBy: null,
    reversedByRole: null,
    reversedAt: null,
    reversalReason: null,
    entryId: null,
    reversalEntryId: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("finance_ops admin session & role checks", () => {
  it("admits finance_ops into ADMIN_CONSOLE_ROLES and ops-credit management", () => {
    expect(isAdminConsoleRole("finance_ops")).toBe(true);
    expect(canManageOpsCredits("finance_ops")).toBe(true);
    expect(canManageOpsCredits("ops_admin")).toBe(true);
    expect(canManageOpsCredits("admin")).toBe(true);
    expect(canManageOpsCredits("super_admin")).toBe(true);
    expect(canManageOpsCredits("ops")).toBe(false);
    expect(canManageOpsCredits("config_admin")).toBe(false);
    expect(canManageOpsCredits("driver")).toBe(false);
  });

  it("packages integer major units using server currencyFractionDigits", () => {
    expect(majorUnitsToMinor("5,000", 2)).toBe(500_000);
    expect(majorUnitsToMinor("250", 0)).toBe(250);
    expect(majorUnitsToMinor("", 2)).toBeNull();
    expect(majorUnitsToMinor("0", 2)).toBeNull();
  });
});

describe("evaluateApproveEligibility & OpsCreditsView rendering", () => {
  it("disables self-approval with a clear two-person explanation and allows a second operator", () => {
    const author = makeOperator({ id: "usr_fin_01" });
    const peer = makeOperator({ id: "usr_fin_02" });
    const credit = makeCredit({ createdBy: "usr_fin_01" });

    const selfCheck = evaluateApproveEligibility(credit, author, true);
    expect(selfCheck.allowed).toBe(false);
    expect(selfCheck.selfAuthor).toBe(true);
    expect(selfCheck.reason).toContain("Two-person rule");

    const peerCheck = evaluateApproveEligibility(credit, peer, true);
    expect(peerCheck.allowed).toBe(true);
    expect(peerCheck.selfAuthor).toBe(false);

    const html = renderToStaticMarkup(
      <OpsCreditsView
        session={author}
        cityId="LOS"
        onCityIdChange={() => undefined}
        statusFilter="pending_approval"
        onStatusFilterChange={() => undefined}
        cityConfig={cityConfig}
        flagEnabled
        credits={[credit]}
        isLoading={false}
        errorMessage={null}
        banner={null}
        form={{
          driverUserId: "",
          amountMajor: "",
          reasonCode: "bank_deposit_verified",
          reference: "",
          note: "",
        }}
        onFormChange={() => undefined}
        onSubmitCreate={() => undefined}
        isSubmitting={false}
        onApprove={() => undefined}
        dialog={null}
        onOpenDialog={() => undefined}
        onDialogReasonChange={() => undefined}
        onCancelDialog={() => undefined}
        onConfirmDialog={() => undefined}
      />,
    );

    expect(html).toContain(
      'data-testid="ops-credits.self-approve-blocked.ocrd_01"',
    );
    expect(html).toContain("Two-person rule");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="ops-credits\.approve\.ocrd_01"/,
    );
  });

  it("renders limited-mode banner and blocks mutations when device is unverified", () => {
    const limitedSession = makeOperator({ id: "usr_fin_02" }, "limited");
    const credit = makeCredit({ createdBy: "usr_fin_01" });

    const html = renderToStaticMarkup(
      <OpsCreditsView
        session={limitedSession}
        cityId="LOS"
        onCityIdChange={() => undefined}
        statusFilter="pending_approval"
        onStatusFilterChange={() => undefined}
        cityConfig={cityConfig}
        flagEnabled
        credits={[credit]}
        isLoading={false}
        errorMessage={null}
        banner={null}
        form={{
          driverUserId: "",
          amountMajor: "",
          reasonCode: "bank_deposit_verified",
          reference: "",
          note: "",
        }}
        onFormChange={() => undefined}
        onSubmitCreate={() => undefined}
        isSubmitting={false}
        onApprove={() => undefined}
        dialog={null}
        onOpenDialog={() => undefined}
        onDialogReasonChange={() => undefined}
        onCancelDialog={() => undefined}
        onConfirmDialog={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="ops-credits.limited-banner"');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="ops-credits\.submit-create"/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="ops-credits\.approve\.ocrd_01"/,
    );
  });
});

describe("opsCreditsApi network calls", () => {
  it("attaches Idempotency-Key on create, approve, reject, and reverse mutations", async () => {
    const calls: {
      url: string;
      method: string;
      idem: string | null;
      body: string | null;
    }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        idem: headers.get("idempotency-key"),
        body: typeof init?.body === "string" ? init.body : null,
      });
      return new Response(
        JSON.stringify({
          credit: makeCredit(),
          balanceAfter: { amountMinor: 500_000, currency: "NGN" },
          replayed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await opsCreditsApi.create({
      cityId: "LOS",
      driverUserId: "usr_driver_01",
      amountMinor: 500_000,
      reasonCode: "bank_deposit_verified",
    });
    await opsCreditsApi.approve("ocrd_01");
    await opsCreditsApi.reject("ocrd_01", "Duplicate deposit slip");
    await opsCreditsApi.reverse("ocrd_01", "Posted to wrong driver ID");

    expect(calls).toHaveLength(4);
    expect(calls[0]?.url).toBe("/api/gateway/v1/ops/wallet-credits");
    expect(calls[1]?.url).toBe(
      "/api/gateway/v1/ops/wallet-credits/ocrd_01/approve",
    );
    expect(calls[2]?.url).toBe(
      "/api/gateway/v1/ops/wallet-credits/ocrd_01/reject",
    );
    expect(calls[3]?.url).toBe(
      "/api/gateway/v1/ops/wallet-credits/ocrd_01/reverse",
    );
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.idem).toBeTruthy();
      expect((call.idem ?? "").length).toBeGreaterThanOrEqual(8);
    }
  });
});
