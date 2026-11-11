/**
 * E2E Test: Fleet Portal Hardened Phone + OTP Sign-In, Step-Up & Role Guard (CC-C01, DEC-4 = A)
 *
 * Runs a real headless Chromium browser against:
 *   Next.js fleet-portal (middleware + /api/auth/* + /api/gateway/*)
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
const CONTROL_URL = "http://127.0.0.1:44281";
const FLEET_PHONE = "+2348055550303";
const MERCHANT_PHONE = "+2348055550404";

async function seedUser(input: {
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "FLEET_MANAGER" | "RIDER" | "DRIVER" | "MERCHANT";
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

test.describe("Fleet Portal Real Sign-In & Device Step-Up (CC-C01)", () => {
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
          E2E_GATEWAY_PORT: "44280",
          E2E_CONTROL_PORT: "44281",
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
      phone: FLEET_PHONE,
      email: "adewale.fleet@ubi.africa",
      firstName: "Adewale",
      lastName: "Balogun",
      role: "FLEET_MANAGER",
    });
    await seedUser({
      phone: MERCHANT_PHONE,
      email: "shop.merchant@example.com",
      firstName: "Shop",
      lastName: "Merchant",
      role: "MERCHANT",
    });
  });

  test.afterAll(async () => {
    if (backendProc && !backendProc.killed) {
      backendProc.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  test("guards unauthenticated portal routes and refuses MERCHANT role with 403", async ({
    page,
  }) => {
    await page.goto("/vehicles");

    // Middleware redirects to /login?next=%2Fvehicles
    await expect(page).toHaveURL(/\/login\?next=%2Fvehicles/);

    // Negative control: MERCHANT completes real OTP flow and is refused with explained banner + 0 cookies
    await page.getByTestId("fleet.signIn.phoneInput").fill(MERCHANT_PHONE);
    await page.getByTestId("fleet.signIn.sendCode").click();

    await expect(page.getByTestId("fleet.signIn.otpForm")).toBeVisible();
    const merchantOtp = await latestMockOtp(MERCHANT_PHONE);
    await page.getByTestId("fleet.signIn.codeInput").fill(merchantOtp);
    await page.getByTestId("fleet.signIn.verifyCode").click();

    await expect(page.getByTestId("fleet.signIn.roleRefused")).toBeVisible();

    const cookiesAfterMerchant = await page.context().cookies();
    expect(
      cookiesAfterMerchant.find((c) => c.name === "ubi_fleet_session"),
    ).toBeUndefined();
  });

  test("signs in FLEET_MANAGER via HttpOnly SameSite=Strict cookie, enforces limited-mode gate on a 2nd browser, completes trusted-device step-up, and signs out", async ({
    browser,
    baseURL,
  }) => {
    const appOrigin = baseURL ?? "http://localhost:3004";
    const context1 = await browser.newContext({ baseURL: appOrigin });
    const page1 = await context1.newPage();

    // 1. First browser signs in to /vehicles → redirected to /login?next=%2Fvehicles
    await page1.goto("/vehicles");
    await expect(page1).toHaveURL(/\/login\?next=%2Fvehicles/);

    await page1.getByTestId("fleet.signIn.phoneInput").fill(FLEET_PHONE);
    await page1.getByTestId("fleet.signIn.sendCode").click();
    await expect(page1.getByTestId("fleet.signIn.otpForm")).toBeVisible();

    const otp1 = await latestMockOtp(FLEET_PHONE);
    await page1.getByTestId("fleet.signIn.codeInput").fill(otp1);
    await page1.getByTestId("fleet.signIn.verifyCode").click();

    // First device is trusted (DEC-7 = A) → lands back on /vehicles
    await expect(page1).toHaveURL(/\/vehicles$/);
    await expect(page1.getByText("Adewale Balogun")).toBeVisible();

    const cookies1 = await context1.cookies();
    const sessionCookie = cookies1.find((c) => c.name === "ubi_fleet_session");
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Strict");

    const clientVisibleSecrets = await page1.evaluate(() => ({
      docCookie: document.cookie,
      legacyToken: localStorage.getItem("fleet_token"),
    }));
    expect(clientVisibleSecrets.docCookie).not.toContain("ubi_fleet_session");
    expect(clientVisibleSecrets.legacyToken).toBeNull();

    // 2. Second fresh browser context signs in with the same account → lands in LIMITED mode
    const context2 = await browser.newContext({ baseURL: appOrigin });
    const page2 = await context2.newPage();

    await page2.goto("/login");
    await page2.getByTestId("fleet.signIn.phoneInput").fill(FLEET_PHONE);
    await page2.getByTestId("fleet.signIn.sendCode").click();
    await expect(page2.getByTestId("fleet.signIn.otpForm")).toBeVisible();

    const otp2 = await latestMockOtp(FLEET_PHONE);
    await page2.getByTestId("fleet.signIn.codeInput").fill(otp2);
    await page2.getByTestId("fleet.signIn.verifyCode").click();

    await expect(page2.getByTestId("fleet.signIn.stepUpCard")).toBeVisible();
    const challengeId = (
      await page2.getByTestId("fleet.signIn.challengeId").textContent()
    )?.trim();
    expect(challengeId).toBeTruthy();

    // Navigating directly to /dashboard on unverified 2nd browser shows LimitedModeGate & ZERO fleet nav links
    await page2.goto("/dashboard");
    await expect(
      page2.getByTestId("fleet.signIn.limitedModeGate"),
    ).toBeVisible();
    await expect(page2.getByText("Staff & roles")).toHaveCount(0);

    // 3. Trusted 1st browser approves the 2nd browser's challengeId from the top bar
    await page1.getByTestId("fleet.signIn.approveDeviceToggle").click();
    await page1.getByPlaceholder("Paste challenge ID").fill(challengeId ?? "");
    await page1.getByRole("button", { name: /approve challenge/i }).click();
    await expect(page1.getByText(/device approved/i)).toBeVisible();

    // 2nd browser clicks "I approved this device — continue" → rotates session to full mode!
    await page2.getByTestId("fleet.signIn.checkApproval").click();
    await expect(page2.getByTestId("fleet.signIn.limitedModeGate")).toHaveCount(
      0,
    );
    await expect(page2.getByText("Staff & roles")).toBeVisible();

    // 4. Sign out on 1st browser clears cookie, revokes upstream session, and redirects to /login
    await page1.getByTestId("fleet.signIn.signOut").click();
    await expect(page1).toHaveURL(/\/login/);

    await context1.close();
    await context2.close();
  });
});
