import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FleetLoginView } from "@/components/auth/FleetLoginView";
import {
  FleetAuthShell,
  FleetSessionProvider,
} from "@/components/providers/fleet-session-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import type { PublicFleetSession } from "@/lib/session";
import { FLEET_ACCOUNT_TEST_IDS } from "@/lib/test-ids";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const FULL_SESSION: PublicFleetSession = {
  user: {
    id: "usr_fleet_01",
    phone: "+2348011112222",
    email: "adewale@fleet.example",
    firstName: "Adewale",
    lastName: "Balogun",
    role: "fleet_manager",
    homeCityId: "LOS",
  },
  mode: "full",
  expiresAt: Date.now() + 15 * 60 * 1000,
  stepUp: null,
};

const LIMITED_SESSION: PublicFleetSession = {
  ...FULL_SESSION,
  mode: "limited",
  stepUp: {
    required: true,
    challengeId: "chal_fleet_untrusted_88",
    methods: ["old_device_approve", "selfie_nin"],
  },
};

const CITYLESS_SESSION: PublicFleetSession = {
  ...FULL_SESSION,
  user: {
    ...FULL_SESSION.user,
    homeCityId: null,
  },
};

describe("FleetLoginView (CC-C01)", () => {
  it("renders phone + OTP sign-in with D1 testIDs and shows 'signed out elsewhere' banner when reason=session_ended", () => {
    const html = renderToStaticMarkup(
      <FleetLoginView nextPath="/calendar" reason="session_ended" />,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.signIn.phoneForm}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.signIn.phoneInput}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.signIn.sendCode}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.signIn.signedOutElsewhere}"`,
    );
    expect(html).toContain("Session ended");
  });
});

describe("FleetAuthShell limited-mode and city-selection gating (CC-C01)", () => {
  it("renders 'Verify this browser' state and ZERO fleet action buttons when session.mode === 'limited'", () => {
    const html = renderToStaticMarkup(
      <QueryProvider>
        <FleetSessionProvider initialSession={LIMITED_SESSION}>
          <FleetAuthShell>
            <div>
              <button type="button" data-testid="propose-assignment-action">
                Propose driver assignment
              </button>
            </div>
          </FleetAuthShell>
        </FleetSessionProvider>
      </QueryProvider>,
    );

    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.signIn.limitedModeGate}"`,
    );
    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.signIn.stepUpCard}"`,
    );
    expect(html).toContain("Verify this browser");
    expect(html).toContain("chal_fleet_untrusted_88");

    // Negative control: child fleet actions and navigation links are suppressed
    expect(html).not.toContain("propose-assignment-action");
    expect(html).not.toContain("Propose driver assignment");
    expect(html).not.toContain("Staff &amp; roles");
  });

  it("renders CitySelectionGate when session.user.homeCityId is null", () => {
    const html = renderToStaticMarkup(
      <QueryProvider>
        <FleetSessionProvider initialSession={CITYLESS_SESSION}>
          <FleetAuthShell>
            <div data-testid="fleet-child-screen">Child screen</div>
          </FleetAuthShell>
        </FleetSessionProvider>
      </QueryProvider>,
    );

    expect(html).toContain(
      `data-testid="${FLEET_ACCOUNT_TEST_IDS.signIn.cityForm}"`,
    );
    expect(html).toContain("Choose your operating city");
    expect(html).not.toContain("fleet-child-screen");
  });
});
