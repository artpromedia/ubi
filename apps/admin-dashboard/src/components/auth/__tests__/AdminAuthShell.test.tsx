import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AdminLoginView } from "@/app/login/page";
import {
  AdminSessionProvider,
  AdminShell,
} from "@/components/providers/admin-session-provider";

import type { PublicAdminSession } from "@/lib/session";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const FULL_SESSION: PublicAdminSession = {
  user: {
    id: "usr_admin_01",
    phone: "+2348011112222",
    email: "adaeze@ubi.africa",
    firstName: "Adaeze",
    lastName: "Okafor",
    role: "super_admin",
    homeCityId: "LOS",
  },
  mode: "full",
  expiresAt: Date.now() + 15 * 60 * 1000,
  stepUp: null,
};

const LIMITED_SESSION: PublicAdminSession = {
  ...FULL_SESSION,
  mode: "limited",
  stepUp: {
    required: true,
    challengeId: "chal_untrusted_device_99",
    methods: ["old_device_approve", "selfie_nin"],
  },
};

describe("AdminLoginView (CC-B05)", () => {
  it("renders phone + OTP sign-in and removes fake Google, GitHub, and password controls", () => {
    const html = renderToStaticMarkup(
      <AdminLoginView nextPath="/marketplace" />,
    );
    expect(html).toContain("Operator phone number");
    expect(html).toContain("Send verification code");
    expect(html).not.toContain("Google");
    expect(html).not.toContain("GitHub");
    expect(html).not.toContain("Forgot password");
    expect(html).not.toContain('type="password"');
  });
});

describe("AdminShell limited-mode vs full-mode gating (CC-B05)", () => {
  it("renders 'Verify this device' state and ZERO console action buttons when session.mode === 'limited'", () => {
    const html = renderToStaticMarkup(
      <AdminSessionProvider initialSession={LIMITED_SESSION}>
        <AdminShell>
          <div>
            <button type="button" data-testid="danger-kill-switch">
              Trigger city kill switch
            </button>
          </div>
        </AdminShell>
      </AdminSessionProvider>,
    );

    expect(html).toContain('data-testid="admin.limited-mode-gate"');
    expect(html).toContain("Verify this device");
    expect(html).toContain("chal_untrusted_device_99");
    expect(html).toContain('data-testid="sidebar.limited-notice"');

    // Negative assertions: zero child action buttons and zero sidebar section links
    expect(html).not.toContain("danger-kill-switch");
    expect(html).not.toContain("Trigger city kill switch");
    expect(html).not.toContain("Fraud Center");
    expect(html).not.toContain("John Doe");
  });

  it("renders real operator identity, sign-out control, and console content when session.mode === 'full'", () => {
    const html = renderToStaticMarkup(
      <AdminSessionProvider initialSession={FULL_SESSION}>
        <AdminShell>
          <div data-testid="live-console-board">Console board ready</div>
        </AdminShell>
      </AdminSessionProvider>,
    );

    expect(html).toContain("Adaeze Okafor");
    expect(html).toContain("Super Admin");
    expect(html).toContain('data-testid="sidebar.signout"');
    expect(html).toContain('data-testid="header.approve-device-toggle"');
    expect(html).toContain("Console board ready");
    expect(html).not.toContain("John Doe");
    expect(html).not.toContain('data-testid="admin.limited-mode-gate"');
  });
});
