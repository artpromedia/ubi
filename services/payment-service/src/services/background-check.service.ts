/**
 * UBI Background Check Service
 *
 * Comprehensive background verification:
 * - Criminal record checks
 * - Driving record verification
 * - Credit checks (for drivers)
 * - Continuous monitoring
 * - Multi-provider integration
 * - Country-specific checks
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import { bgCheckLogger } from "../lib/logger";
import {
  BackgroundCheck,
  BackgroundCheckFinding,
  BackgroundCheckRequest,
  BackgroundCheckStatus,
  BackgroundCheckType,
  COUNTRY_CONFIGS,
  DocumentType,
} from "../types/safety.types";

// =============================================================================
// BACKGROUND CHECK SERVICE
// =============================================================================

export class BackgroundCheckService extends EventEmitter {
  private backgroundChecks: Map<string, BackgroundCheck[]> = new Map();
  private monitoringAlerts: Map<string, MonitoringAlert[]> = new Map();
  private providers: Map<string, BackgroundCheckProvider> = new Map();

  // Check validity periods (days)
  private readonly CRIMINAL_CHECK_VALIDITY_DAYS = 365;
  private readonly DRIVING_CHECK_VALIDITY_DAYS = 180;
  private readonly CREDIT_CHECK_VALIDITY_DAYS = 90;

  constructor() {
    super();
    this.initializeProviders();
  }

  // ---------------------------------------------------------------------------
  // PROVIDER INITIALIZATION
  // ---------------------------------------------------------------------------

  private initializeProviders(): void {
    // Nigeria Police Check
    this.providers.set("nigeria_police", new NigeriaPoliceProvider());

    // Kenya Police (DCI)
    this.providers.set("kenya_police", new KenyaPoliceProvider());

    // South Africa (SAPS)
    this.providers.set("saps", new SAPSProvider());

    // Ghana Police
    this.providers.set("ghana_police", new GhanaPoliceProvider());

    // Generic/International Provider (Checkr, Sterling, etc.)
    this.providers.set("checkr", new CheckrProvider());

    bgCheckLogger.info(
      { providers: Array.from(this.providers.keys()) },
      "[BackgroundCheck] Initialized providers",
    );
  }

  // ---------------------------------------------------------------------------
  // CHECK INITIATION
  // ---------------------------------------------------------------------------

  async initiateBackgroundCheck(
    request: BackgroundCheckRequest,
  ): Promise<BackgroundCheckResult[]> {
    const {
      userId,
      checkTypes,
      country,
      idNumber,
      idType,
      firstName,
      lastName,
      dateOfBirth,
      consentGiven,
    } = request;

    // Verify consent
    if (!consentGiven) {
      throw new Error("User consent required for background check");
    }

    // Get country config
    const countryConfig = COUNTRY_CONFIGS[country];
    if (!countryConfig) {
      throw new Error(`Background checks not supported in country: ${country}`);
    }

    // Get provider for country
    const provider = this.providers.get(countryConfig.backgroundCheckProvider);
    if (!provider) {
      throw new Error(`No provider available for country: ${country}`);
    }

    const results: BackgroundCheckResult[] = [];

    for (const checkType of checkTypes) {
      // Check for existing valid check
      const existingCheck = await this.getValidCheck(userId, checkType);
      if (existingCheck) {
        results.push({
          checkType,
          status: existingCheck.status,
          existingCheck: true,
          check: existingCheck,
        });
        continue;
      }

      // Create new check
      const check = await this.createCheck({
        userId,
        checkType,
        provider: provider.name,
        country,
      });

      try {
        // Submit to provider
        const providerResult = await provider.submitCheck({
          checkType,
          firstName,
          lastName,
          idNumber,
          idType,
          dateOfBirth,
          country,
        });

        check.providerReference = providerResult.reference;
        check.status = "IN_PROGRESS";

        results.push({
          checkType,
          status: "IN_PROGRESS",
          check,
          reference: providerResult.reference,
        });

        bgCheckLogger.info(
          { checkId: check.id, checkType },
          "[BackgroundCheck] Check initiated",
        );
      } catch (error) {
        check.status = "COMPLETED_FAIL";
        results.push({
          checkType,
          status: "COMPLETED_FAIL",
          error: "Failed to initiate check",
        });
      }
    }

    return results;
  }

  async checkStatus(
    userId: string,
    checkType: BackgroundCheckType,
  ): Promise<BackgroundCheck | null> {
    const checks = this.backgroundChecks.get(userId) || [];
    const check = checks.find((c) => c.checkType === checkType);

    if (!check || check.status !== "IN_PROGRESS") {
      return check || null;
    }

    // Query provider for status
    const provider = this.providers.get(check.provider);
    if (!provider || !check.providerReference) {
      return check;
    }

    try {
      const statusResult = await provider.getStatus(check.providerReference);

      check.status = this.mapProviderStatus(statusResult.status);

      if (statusResult.findings) {
        check.findings = statusResult.findings;
        check.hasCriticalFindings = statusResult.findings.some(
          (f) => f.severity === "critical",
        );
      }

      if (check.status.startsWith("COMPLETED")) {
        check.completedAt = new Date();
        check.validUntil = this.calculateValidUntil(check.checkType);

        this.emit("background_check_completed", { userId, check });
      }

      return check;
    } catch (error) {
      bgCheckLogger.error(
        { err: error },
        "[BackgroundCheck] Status check failed",
      );
      return check;
    }
  }

  // ---------------------------------------------------------------------------
  // CHECK RETRIEVAL
  // ---------------------------------------------------------------------------

  async getUserBackgroundChecks(userId: string): Promise<BackgroundCheck[]> {
    return this.backgroundChecks.get(userId) || [];
  }

  async getValidCheck(
    userId: string,
    checkType: BackgroundCheckType,
  ): Promise<BackgroundCheck | null> {
    const checks = this.backgroundChecks.get(userId) || [];

    return (
      checks.find(
        (c) =>
          c.checkType === checkType &&
          c.status === "COMPLETED_CLEAR" &&
          c.validUntil &&
          c.validUntil > new Date(),
      ) || null
    );
  }

  async hasValidBackgroundCheck(userId: string): Promise<boolean> {
    const criminalCheck = await this.getValidCheck(userId, "CRIMINAL_RECORD");
    return criminalCheck !== null && criminalCheck.status === "COMPLETED_CLEAR";
  }

  async getBackgroundCheckSummary(
    userId: string,
  ): Promise<BackgroundCheckSummary> {
    const checks = await this.getUserBackgroundChecks(userId);

    const summary: BackgroundCheckSummary = {
      userId,
      hasValidCriminalCheck: false,
      hasValidDrivingCheck: false,
      hasValidCreditCheck: false,
      criticalFindingsCount: 0,
      lastCheckDate: null,
      nextCheckDue: null,
      overallStatus: "NOT_STARTED",
    };

    for (const check of checks) {
      const isValid = check.validUntil && check.validUntil > new Date();

      if (
        check.checkType === "CRIMINAL_RECORD" &&
        check.status === "COMPLETED_CLEAR" &&
        isValid
      ) {
        summary.hasValidCriminalCheck = true;
      }
      if (
        check.checkType === "DRIVING_RECORD" &&
        check.status === "COMPLETED_CLEAR" &&
        isValid
      ) {
        summary.hasValidDrivingCheck = true;
      }
      if (
        check.checkType === "CREDIT_CHECK" &&
        check.status === "COMPLETED_CLEAR" &&
        isValid
      ) {
        summary.hasValidCreditCheck = true;
      }

      if (check.hasCriticalFindings) {
        summary.criticalFindingsCount++;
      }

      if (check.completedAt) {
        if (
          !summary.lastCheckDate ||
          check.completedAt > summary.lastCheckDate
        ) {
          summary.lastCheckDate = check.completedAt;
        }
      }

      if (check.validUntil) {
        if (!summary.nextCheckDue || check.validUntil < summary.nextCheckDue) {
          summary.nextCheckDue = check.validUntil;
        }
      }
    }

    // Determine overall status
    if (summary.criticalFindingsCount > 0) {
      summary.overallStatus = "FAILED";
    } else if (summary.hasValidCriminalCheck && summary.hasValidDrivingCheck) {
      summary.overallStatus = "CLEAR";
    } else if (checks.some((c) => c.status === "IN_PROGRESS")) {
      summary.overallStatus = "IN_PROGRESS";
    } else if (checks.length > 0) {
      summary.overallStatus = "INCOMPLETE";
    }

    return summary;
  }

  // ---------------------------------------------------------------------------
  // CONTINUOUS MONITORING
  // ---------------------------------------------------------------------------

  async enableContinuousMonitoring(userId: string): Promise<void> {
    // In production, register for continuous monitoring with providers
    bgCheckLogger.info(
      { userId },
      "[BackgroundCheck] Continuous monitoring enabled",
    );

    // Start monitoring job
    this.startMonitoringJob(userId);
  }

  async disableContinuousMonitoring(userId: string): Promise<void> {
    bgCheckLogger.info(
      { userId },
      "[BackgroundCheck] Continuous monitoring disabled",
    );
  }

  private startMonitoringJob(userId: string): void {
    // Run daily monitoring check
    setInterval(
      async () => {
        await this.runMonitoringCheck(userId);
      },
      24 * 60 * 60 * 1000,
    );
  }

  private async runMonitoringCheck(userId: string): Promise<void> {
    const checks = await this.getUserBackgroundChecks(userId);

    for (const check of checks) {
      if (!check.validUntil) continue;

      // Alert if check is expiring soon (within 30 days)
      const daysUntilExpiry =
        (check.validUntil.getTime() - Date.now()) / (24 * 60 * 60 * 1000);

      if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
        await this.createMonitoringAlert(userId, {
          type: "expiring_check",
          checkType: check.checkType,
          daysUntilExpiry,
          message: `${check.checkType} check expires in ${Math.round(daysUntilExpiry)} days`,
        });
      }

      // Check if expired
      if (check.validUntil < new Date()) {
        await this.createMonitoringAlert(userId, {
          type: "expired_check",
          checkType: check.checkType,
          message: `${check.checkType} check has expired`,
        });
      }
    }

    // In production, also check for new criminal records with monitoring provider
  }

  private async createMonitoringAlert(
    userId: string,
    alertData: MonitoringAlertData,
  ): Promise<void> {
    const alerts = this.monitoringAlerts.get(userId) || [];

    const alert: MonitoringAlert = {
      id: this.generateId(),
      userId,
      ...alertData,
      createdAt: new Date(),
      acknowledged: false,
    };

    alerts.push(alert);
    this.monitoringAlerts.set(userId, alerts);

    this.emit("monitoring_alert", alert);

    bgCheckLogger.info(
      { alertType: alert.type, userId },
      "[BackgroundCheck] Monitoring alert",
    );
  }

  async getMonitoringAlerts(userId: string): Promise<MonitoringAlert[]> {
    return this.monitoringAlerts.get(userId) || [];
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    for (const [, alerts] of this.monitoringAlerts) {
      const alert = alerts.find((a) => a.id === alertId);
      if (alert) {
        alert.acknowledged = true;
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CHECK RENEWAL
  // ---------------------------------------------------------------------------

  async renewExpiredChecks(userId: string): Promise<BackgroundCheckResult[]> {
    const checks = await this.getUserBackgroundChecks(userId);
    const expiredChecks = checks.filter(
      (c) =>
        c.validUntil &&
        c.validUntil < new Date() &&
        c.status === "COMPLETED_CLEAR",
    );

    if (expiredChecks.length === 0) {
      return [];
    }

    // Get user's ID info from most recent check
    const latestCheck = checks.sort(
      (a, b) =>
        (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0),
    )[0];

    if (!latestCheck) {
      return [];
    }

    // In production, fetch actual user details
    const request: BackgroundCheckRequest = {
      userId,
      checkTypes: expiredChecks.map((c) => c.checkType),
      country: latestCheck.country,
      idNumber: "", // Would fetch from user profile
      idType: "NIN" as DocumentType,
      firstName: "",
      lastName: "",
      consentGiven: true, // Would need to re-confirm consent
    };

    return this.initiateBackgroundCheck(request);
  }

  // ---------------------------------------------------------------------------
  // DRIVER SPECIFIC CHECKS
  // ---------------------------------------------------------------------------

  async initiateDriverBackgroundCheck(
    driverId: string,
    country: string,
  ): Promise<BackgroundCheckResult[]> {
    const requiredChecks: BackgroundCheckType[] = [
      "CRIMINAL_RECORD",
      "DRIVING_RECORD",
    ];

    // Add credit check for high-value markets
    if (["ZA", "NG"].includes(country)) {
      requiredChecks.push("CREDIT_CHECK");
    }

    // Add reference check
    requiredChecks.push("REFERENCE");

    const request: BackgroundCheckRequest = {
      userId: driverId,
      checkTypes: requiredChecks,
      country,
      idNumber: "", // Would fetch from verification records
      idType: "NIN" as DocumentType,
      firstName: "",
      lastName: "",
      consentGiven: true,
    };

    return this.initiateBackgroundCheck(request);
  }

  async isDriverClear(driverId: string): Promise<DriverClearanceResult> {
    const summary = await this.getBackgroundCheckSummary(driverId);

    const isCleared =
      summary.hasValidCriminalCheck &&
      summary.hasValidDrivingCheck &&
      summary.criticalFindingsCount === 0;

    return {
      isCleared,
      hasValidCriminalCheck: summary.hasValidCriminalCheck,
      hasValidDrivingCheck: summary.hasValidDrivingCheck,
      criticalFindingsCount: summary.criticalFindingsCount,
      reason: !isCleared ? this.getClearanceFailureReason(summary) : undefined,
    };
  }

  private getClearanceFailureReason(summary: BackgroundCheckSummary): string {
    if (summary.criticalFindingsCount > 0) {
      return "Critical findings in background check";
    }
    if (!summary.hasValidCriminalCheck) {
      return "Criminal record check required or expired";
    }
    if (!summary.hasValidDrivingCheck) {
      return "Driving record check required or expired";
    }
    return "Background check incomplete";
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  private async createCheck(
    data: Partial<BackgroundCheck>,
  ): Promise<BackgroundCheck> {
    const check: BackgroundCheck = {
      id: this.generateId(),
      userId: data.userId!,
      checkType: data.checkType!,
      status: "INITIATED",
      provider: data.provider!,
      country: data.country!,
      consentGiven: true,
      hasCriticalFindings: false,
    };

    const userChecks = this.backgroundChecks.get(check.userId) || [];
    userChecks.push(check);
    this.backgroundChecks.set(check.userId, userChecks);

    return check;
  }

  private mapProviderStatus(providerStatus: string): BackgroundCheckStatus {
    const statusMap: Record<string, BackgroundCheckStatus> = {
      pending: "IN_PROGRESS",
      in_progress: "IN_PROGRESS",
      clear: "COMPLETED_CLEAR",
      review: "COMPLETED_REVIEW",
      fail: "COMPLETED_FAIL",
      expired: "EXPIRED",
    };

    return statusMap[providerStatus.toLowerCase()] || "IN_PROGRESS";
  }

  private calculateValidUntil(checkType: BackgroundCheckType): Date {
    const now = new Date();
    let daysValid = 365;

    switch (checkType) {
      case "CRIMINAL_RECORD":
        daysValid = this.CRIMINAL_CHECK_VALIDITY_DAYS;
        break;
      case "DRIVING_RECORD":
        daysValid = this.DRIVING_CHECK_VALIDITY_DAYS;
        break;
      case "CREDIT_CHECK":
        daysValid = this.CREDIT_CHECK_VALIDITY_DAYS;
        break;
    }

    return new Date(now.getTime() + daysValid * 24 * 60 * 60 * 1000);
  }

  private generateId(): string {
    return `bgc_${crypto.randomBytes(12).toString("hex")}`;
  }
}

// =============================================================================
// PROVIDER IMPLEMENTATIONS
// =============================================================================

interface BackgroundCheckProvider {
  name: string;
  submitCheck(params: ProviderCheckParams): Promise<ProviderSubmitResult>;
  getStatus(reference: string): Promise<ProviderStatusResult>;
}

interface ProviderCheckParams {
  checkType: BackgroundCheckType;
  firstName: string;
  lastName: string;
  idNumber: string;
  idType: DocumentType;
  dateOfBirth?: string;
  country: string;
}

interface ProviderSubmitResult {
  reference: string;
  status: string;
}

interface ProviderStatusResult {
  status: string;
  findings?: BackgroundCheckFinding[];
}

class NigeriaPoliceProvider implements BackgroundCheckProvider {
  name = "nigeria_police";

  async submitCheck(
    params: ProviderCheckParams,
  ): Promise<ProviderSubmitResult> {
    bgCheckLogger.info(
      { firstName: params.firstName },
      "[NigeriaPolice] Submitting check",
    );

    return {
      reference: `npf_${crypto.randomBytes(8).toString("hex")}`,
      status: "pending",
    };
  }

  async getStatus(_reference: string): Promise<ProviderStatusResult> {
    // Simulate response
    return {
      status: "clear",
      findings: [],
    };
  }
}

class KenyaPoliceProvider implements BackgroundCheckProvider {
  name = "kenya_police";

  async submitCheck(
    _params: ProviderCheckParams,
  ): Promise<ProviderSubmitResult> {
    bgCheckLogger.info("[KenyaPolice] Submitting DCI check");

    return {
      reference: `dci_${crypto.randomBytes(8).toString("hex")}`,
      status: "pending",
    };
  }

  async getStatus(_reference: string): Promise<ProviderStatusResult> {
    return {
      status: "clear",
    };
  }
}

class SAPSProvider implements BackgroundCheckProvider {
  name = "saps";

  async submitCheck(
    _params: ProviderCheckParams,
  ): Promise<ProviderSubmitResult> {
    bgCheckLogger.info("[SAPS] Submitting South African police check");

    return {
      reference: `saps_${crypto.randomBytes(8).toString("hex")}`,
      status: "pending",
    };
  }

  async getStatus(_reference: string): Promise<ProviderStatusResult> {
    return {
      status: "clear",
    };
  }
}

class GhanaPoliceProvider implements BackgroundCheckProvider {
  name = "ghana_police";

  async submitCheck(
    _params: ProviderCheckParams,
  ): Promise<ProviderSubmitResult> {
    bgCheckLogger.info("[GhanaPolice] Submitting check");

    return {
      reference: `gps_${crypto.randomBytes(8).toString("hex")}`,
      status: "pending",
    };
  }

  async getStatus(_reference: string): Promise<ProviderStatusResult> {
    return {
      status: "clear",
    };
  }
}

class CheckrProvider implements BackgroundCheckProvider {
  name = "checkr";

  async submitCheck(
    _params: ProviderCheckParams,
  ): Promise<ProviderSubmitResult> {
    bgCheckLogger.info("[Checkr] Submitting international check");

    return {
      reference: `checkr_${crypto.randomBytes(8).toString("hex")}`,
      status: "pending",
    };
  }

  async getStatus(_reference: string): Promise<ProviderStatusResult> {
    return {
      status: "clear",
    };
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface BackgroundCheckResult {
  checkType: BackgroundCheckType;
  status: BackgroundCheckStatus | "COMPLETED_FAIL";
  existingCheck?: boolean;
  check?: BackgroundCheck;
  reference?: string;
  error?: string;
}

interface BackgroundCheckSummary {
  userId: string;
  hasValidCriminalCheck: boolean;
  hasValidDrivingCheck: boolean;
  hasValidCreditCheck: boolean;
  criticalFindingsCount: number;
  lastCheckDate: Date | null;
  nextCheckDue: Date | null;
  overallStatus:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "INCOMPLETE"
    | "CLEAR"
    | "FAILED";
}

interface MonitoringAlertData {
  type: "expiring_check" | "expired_check" | "new_record" | "status_change";
  checkType?: BackgroundCheckType;
  daysUntilExpiry?: number;
  message: string;
}

interface MonitoringAlert extends MonitoringAlertData {
  id: string;
  userId: string;
  createdAt: Date;
  acknowledged: boolean;
}

interface DriverClearanceResult {
  isCleared: boolean;
  hasValidCriminalCheck: boolean;
  hasValidDrivingCheck: boolean;
  criticalFindingsCount: number;
  reason?: string;
}

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const backgroundCheckService = new BackgroundCheckService();
