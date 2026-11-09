/**
 * E2E Test: Admin Console Hardened Phone + OTP Sign-In, Step-Up & Role Guard (CC-B05)
 *
 * Runs a real headless Chromium browser against:
 *   Next.js admin-dashboard (middleware + /api/auth/* + /api/gateway/*)
 *     → REAL in-process `api-gateway` (JWT verification + scope matrix + signed identity)
 *     → REAL in-process `user-service` (scrypt OTP + device enrolment + step-up + Postgres + Redis)
 *
 * MOCK DISCLOSURE: Only the external SMS transport (`MOCK_SMS_PROVIDER` in
 * `services/api-gateway/tests/e2e-admin-auth-harness.ts`) and biometric face
 * verifier are mocked so no real SMS is sent. All UBI auth, session rotation,
 * device trust, and gateway authorization run unmodified.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { expect, test } from "../fixtures/test-fixtures";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONTROL_URL = "http://127.0.0.1:44181";
const ADMIN_PHONE = "+2348055550101";
const RIDER_PHONE = "+2348055550202";

async function seedUser(input: {
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "SUPER_ADMIN" | "ADMIN" | "RIDER" | "DRIVER";
}): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/seed-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to seed user ${input.phone}: ${res.status}`);
  }
}

/** Reads the 6-digit OTP captured by MOCK_SMS_PROVIDER in the backend harness. */
async function latestMockOtp(phone: string): Promise<string> {
  const res = await fetch(
    `${CONTROL_URL}/latest-otp?phone=${encodeURIComponent(phone)}`,
  );
  const data = (await res.json()) as { code: string | null; provider: string };
  expect(data.provider).toBe("MOCK_SMS_PROVIDER");
  if (!data.code) {
    throw new Error(`No OTP captured by MOCK_SMS_PROVIDER for ${phone}`);
  }
  return data.code;
}

test.describe("Admin Console Real Sign-In & Device Step-Up (CC-B05)", () => {
  test.describe.configure({ mode: "serial" });

  let backendProc: ChildProcess | undefined;

  test.beforeAll(async () => {
    backendProc = spawn(
      "pnpm",
      [
        "--filter",
        "@ubi/api-gateway",
        "exec",
        "tsx",
        "tests/e2e-admin-auth-harness.ts",
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          E2E_GATEWAY_PORT: "44180",
          E2E_CONTROL_PORT: "44181",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out starting in-process auth stack"));
      }, 30_000);

      backendProc?.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("READY ")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      backendProc?.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(chunk);
      });
      backendProc?.once("exit", (code) => {
        clearTimeout(timeout);
        reject(
          new Error(`In-process auth stack exited early with code ${code}`),
        );
      });
    });

    await seedUser({
      phone: ADMIN_PHONE,
      email: "adaeze.super@ubi.africa",
      firstName: "Adaeze",
      lastName: "Okafor",
      role: "SUPER_ADMIN",
    });
    await seedUser({
      phone: RIDER_PHONE,
      email: "tunde.rider@example.com",
      firstName: "Tunde",
      lastName: "Rider",
      role: "RIDER",
    });
  });

  test.afterAll(async () => {
    if (backendProc && !backendProc.killed) {
      backendProc.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  test("guards unauthenticated (admin) routes, removes fake Google/GitHub buttons, and refuses RIDER role with 403", async ({
    page,
  }) => {
    await page.goto("/marketplace");

    // Middleware redirects to /login?next=%2Fmarketplace
    await expect(page).toHaveURL(/\/login\?next=%2Fmarketplace/);

    // Fake SSO buttons and password fields are gone
    await expect(page.getByText("Google")).toHaveCount(0);
    await expect(page.getByText("GitHub")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // Negative control: RIDER completes real OTP flow and is refused with explained banner + 0 cookies
    await page.getByLabel(/operator phone number/i).fill(RIDER_PHONE);
    await page.getByTestId("login.send-code").click();

    await expect(page.getByTestId("login.otp-form")).toBeVisible();
    const riderOtp = await latestMockOtp(RIDER_PHONE);
    await page.getByLabel(/6-digit verification code/i).fill(riderOtp);
    await page.getByTestId("login.verify-code").click();

    await expect(page.getByTestId("login.role-refused")).toBeVisible();
    await expect(page.getByTestId("login.role-refused")).toContainText(
      /does not have operator access/i,
    );

    const cookiesAfterRider = await page.context().cookies();
    expect(
      cookiesAfterRider.find((c) => c.name === "ubi_admin_session"),
    ).toBeUndefined();
  });

  test("signs in SUPER_ADMIN via HttpOnly SameSite=Strict cookie, enforces limited-mode gate on a 2nd browser, completes trusted-device step-up, and signs out", async ({
    browser,
    baseURL,
  }) => {
    const appOrigin = baseURL ?? "http://localhost:3002";
    const context1 = await browser.newContext({ baseURL: appOrigin });
    const page1 = await context1.newPage();

    // 1. First browser signs in to /marketplace → redirected to /login?next=%2Fmarketplace
    await page1.goto("/marketplace");
    await expect(page1).toHaveURL(/\/login\?next=%2Fmarketplace/);

    await page1.getByLabel(/operator phone number/i).fill(ADMIN_PHONE);
    await page1.getByTestId("login.send-code").click();
    await expect(page1.getByTestId("login.otp-form")).toBeVisible();

    const otp1 = await latestMockOtp(ADMIN_PHONE);
    await page1.getByLabel(/6-digit verification code/i).fill(otp1);
    await page1.getByTestId("login.verify-code").click();

    // First device is trusted (DEC-7 = A) → lands back on /marketplace with live operator identity
    await expect(page1).toHaveURL(/\/marketplace$/);
    await expect(page1.getByTestId("sidebar.operator-name")).toHaveText(
      "Adaeze Okafor",
    );
    await expect(page1.getByTestId("sidebar.operator-role")).toContainText(
      "Super Admin",
    );

    // Cookie is HttpOnly + SameSite=Strict; nothing in document.cookie or localStorage
    const cookies1 = await context1.cookies();
    const sessionCookie = cookies1.find((c) => c.name === "ubi_admin_session");
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Strict");

    const clientVisibleSecrets = await page1.evaluate(() => ({
      docCookie: document.cookie,
      legacyToken: localStorage.getItem("ubi_admin_token"),
    }));
    expect(clientVisibleSecrets.docCookie).not.toContain("ubi_admin_session");
    expect(clientVisibleSecrets.legacyToken).toBeNull();

    // 2. Second fresh browser context signs in with the same SUPER_ADMIN → lands in LIMITED mode
    const context2 = await browser.newContext({ baseURL: appOrigin });
    const page2 = await context2.newPage();

    await page2.goto("/login");
    await page2.getByLabel(/operator phone number/i).fill(ADMIN_PHONE);
    await page2.getByTestId("login.send-code").click();
    await expect(page2.getByTestId("login.otp-form")).toBeVisible();

    const otp2 = await latestMockOtp(ADMIN_PHONE);
    await page2.getByLabel(/6-digit verification code/i).fill(otp2);
    await page2.getByTestId("login.verify-code").click();

    // Step-up card appears on /login; grab challengeId
    await expect(page2.getByTestId("admin.step-up-card")).toBeVisible();
    const challengeId = (
      await page2.getByTestId("admin.step-up-challenge-id").textContent()
    )?.trim();
    expect(challengeId).toBeTruthy();

    // Navigating directly to /dashboard on unverified 2nd browser shows LimitedModeGate & ZERO console actions
    await page2.goto("/dashboard");
    await expect(page2.getByTestId("admin.limited-mode-gate")).toBeVisible();
    await expect(page2.getByTestId("sidebar.limited-notice")).toBeVisible();
    await expect(page2.getByText("Fraud Center")).toHaveCount(0);

    // 3. Trusted 1st browser approves the 2nd browser's challengeId from the top bar
    await page1.getByTestId("header.approve-device-toggle").click();
    await page1.getByPlaceholder("Paste challenge ID").fill(challengeId ?? "");
    await page1.getByRole("button", { name: /approve challenge/i }).click();
    await expect(page1.getByText(/device approved/i)).toBeVisible();

    // 2nd browser clicks "I approved this device — continue" → rotates session to full mode!
    await page2.getByTestId("admin.step-up-check-approval").click();
    await expect(page2.getByTestId("admin.limited-mode-gate")).toHaveCount(0);
    await expect(page2.getByText("Fraud Center")).toBeVisible();

    // 4. Sign out on 1st browser clears cookie, revokes upstream session, and redirects to /login
    await page1.getByTestId("sidebar.signout").click();
    await expect(page1).toHaveURL(/\/login/);

    await page1.goto("/dashboard");
    await expect(page1).toHaveURL(/\/login\?next=%2Fdashboard/);

    await context1.close();
    await context2.close();
  });
});
