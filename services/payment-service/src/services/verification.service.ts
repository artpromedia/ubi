/**
 * UBI Verification Service
 *
 * Comprehensive identity verification system supporting:
 * - Document verification (country-specific IDs)
 * - Selfie capture and liveness detection
 * - Face matching (document to selfie)
 * - OTP verification (phone & email)
 * - Multi-provider integration (SmileID, IPRS, XDS, Onfido)
 * - Verification level management
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import {
  COUNTRY_CONFIGS,
  DocumentSubmission,
  DocumentType,
  ExtractedDocumentData,
  FaceMatchResult,
  LivenessResult,
  ProviderVerifyParams,
  ProviderVerifyResult,
  SafetyEvent,
  SelfieCapture,
  UserVerification,
  VerificationCapabilities,
  VerificationLevel,
  VerificationLevelConfig,
  VerificationProvider,
  VerificationResult,
  VerificationStatus,
  VerificationType,
} from "../types/safety.types";

// =============================================================================
// VERIFICATION SERVICE
// =============================================================================

export class VerificationService extends EventEmitter {
  private providers: Map<string, VerificationProvider> = new Map();
  private otpStore: Map<string, OTPRecord> = new Map();
  private verificationCache: Map<string, UserVerification[]> = new Map();

  constructor() {
    super();
    this.initializeProviders();
  }

  // ---------------------------------------------------------------------------
  // PROVIDER INITIALIZATION
  // ---------------------------------------------------------------------------

  private initializeProviders(): void {
    // SmileID - Nigeria, Kenya, Ghana, South Africa
    this.providers.set("smile_id", new SmileIDProvider());

    // IPRS - Kenya Government Integration
    this.providers.set("iprs", new IPRSProvider());

    // XDS - South Africa Credit Bureau
    this.providers.set("xds", new XDSProvider());

    // Home Affairs - South Africa Government
    this.providers.set("home_affairs", new HomeAffairsProvider());

    // Onfido - Fallback/Global
    this.providers.set("onfido", new OnfidoProvider());

    // YouVerify - Nigeria
    this.providers.set("youverify", new YouVerifyProvider());

    console.log(
      "[VerificationService] Initialized with providers:",
      Array.from(this.providers.keys())
    );
  }

  // ---------------------------------------------------------------------------
  // VERIFICATION LEVEL MANAGEMENT
  // ---------------------------------------------------------------------------

  async getUserVerificationLevel(userId: string): Promise<VerificationLevel> {
    const verifications = await this.getUserVerifications(userId);
    return this.calculateVerificationLevel(verifications);
  }

  async getVerificationLevelConfig(
    level: VerificationLevel
  ): Promise<VerificationLevelConfig> {
    return VERIFICATION_LEVEL_CONFIGS[level];
  }

  async getUserCapabilities(userId: string): Promise<VerificationCapabilities> {
    const level = await this.getUserVerificationLevel(userId);
    const config = VERIFICATION_LEVEL_CONFIGS[level];
    return config.capabilities;
  }

  async checkCapability(
    userId: string,
    capability: keyof VerificationCapabilities
  ): Promise<boolean> {
    const capabilities = await this.getUserCapabilities(userId);
    return !!capabilities[capability];
  }

  async getNextRequiredVerification(
    userId: string,
    targetLevel: VerificationLevel
  ): Promise<VerificationType[]> {
    const currentVerifications = await this.getUserVerifications(userId);
    const targetConfig = VERIFICATION_LEVEL_CONFIGS[targetLevel];
    const required: VerificationType[] = [];

    const completedTypes = new Set(
      currentVerifications
        .filter((v) => v.status === "APPROVED")
        .map((v) => v.verificationType)
    );

    if (targetConfig.requirements.phone && !completedTypes.has("PHONE")) {
      required.push("PHONE");
    }
    if (targetConfig.requirements.email && !completedTypes.has("EMAIL")) {
      required.push("EMAIL");
    }
    if (
      targetConfig.requirements.governmentId &&
      !completedTypes.has("GOVERNMENT_ID")
    ) {
      required.push("GOVERNMENT_ID");
    }
    if (targetConfig.requirements.selfie && !completedTypes.has("SELFIE")) {
      required.push("SELFIE");
    }
    if (targetConfig.requirements.liveness && !completedTypes.has("LIVENESS")) {
      required.push("LIVENESS");
    }
    if (
      targetConfig.requirements.driversLicense &&
      !completedTypes.has("DRIVERS_LICENSE")
    ) {
      required.push("DRIVERS_LICENSE");
    }
    if (
      targetConfig.requirements.backgroundCheck &&
      !completedTypes.has("BACKGROUND_CHECK")
    ) {
      required.push("BACKGROUND_CHECK");
    }

    return required;
  }

  private calculateVerificationLevel(
    verifications: UserVerification[]
  ): VerificationLevel {
    const approved = new Set(
      verifications
        .filter(
          (v) =>
            v.status === "APPROVED" &&
            (!v.expiresAt || v.expiresAt > new Date())
        )
        .map((v) => v.verificationType)
    );

    // Check from highest to lowest
    if (
      approved.has("PHONE") &&
      approved.has("EMAIL") &&
      approved.has("GOVERNMENT_ID") &&
      approved.has("SELFIE") &&
      approved.has("LIVENESS") &&
      approved.has("BACKGROUND_CHECK") &&
      approved.has("BIOMETRIC")
    ) {
      return "PREMIUM";
    }

    if (
      approved.has("PHONE") &&
      approved.has("EMAIL") &&
      approved.has("GOVERNMENT_ID") &&
      approved.has("SELFIE") &&
      approved.has("LIVENESS")
    ) {
      // Check if they have vehicle docs for DRIVER level
      if (
        approved.has("VEHICLE") &&
        approved.has("DRIVERS_LICENSE") &&
        approved.has("BACKGROUND_CHECK")
      ) {
        return "DRIVER";
      }
      // Check for merchant level
      if (approved.has("ADDRESS")) {
        return "MERCHANT";
      }
      return "VERIFIED";
    }

    return "BASIC";
  }

  // ---------------------------------------------------------------------------
  // DOCUMENT VERIFICATION
  // ---------------------------------------------------------------------------

  async submitDocument(
    submission: DocumentSubmission
  ): Promise<VerificationResult> {
    const {
      userId,
      documentType,
      country,
      documentFront,
      documentBack,
      metadata,
    } = submission;

    // Validate country support
    const countryConfig = COUNTRY_CONFIGS[country];
    if (!countryConfig) {
      return {
        success: false,
        verification: this.createFailedVerification(
          userId,
          "GOVERNMENT_ID",
          "Unsupported country"
        ),
        confidenceScore: 0,
        issues: [
          {
            code: "UNSUPPORTED_COUNTRY",
            message: `Country ${country} is not supported`,
            severity: "error",
          },
        ],
      };
    }

    // Validate document type for country
    if (!countryConfig.supportedDocuments.includes(documentType)) {
      return {
        success: false,
        verification: this.createFailedVerification(
          userId,
          "GOVERNMENT_ID",
          "Unsupported document type for country"
        ),
        confidenceScore: 0,
        issues: [
          {
            code: "UNSUPPORTED_DOCUMENT",
            message: `Document type ${documentType} is not supported in ${country}`,
            severity: "error",
          },
        ],
      };
    }

    // Check existing verification
    const existing = await this.getVerificationByType(userId, "GOVERNMENT_ID");
    if (
      existing &&
      existing.status === "APPROVED" &&
      (!existing.expiresAt || existing.expiresAt > new Date())
    ) {
      return {
        success: false,
        verification: existing,
        confidenceScore: existing.confidenceScore || 0,
        issues: [
          {
            code: "ALREADY_VERIFIED",
            message: "Document already verified",
            severity: "warning",
          },
        ],
      };
    }

    // Check attempt limits
    const attempts = await this.getVerificationAttempts(
      userId,
      "GOVERNMENT_ID"
    );
    if (attempts >= 5) {
      return {
        success: false,
        verification: this.createFailedVerification(
          userId,
          "GOVERNMENT_ID",
          "Max attempts exceeded"
        ),
        confidenceScore: 0,
        issues: [
          {
            code: "MAX_ATTEMPTS",
            message:
              "Maximum verification attempts exceeded. Please contact support.",
            severity: "error",
          },
        ],
      };
    }

    // Select provider based on country
    const provider = this.selectProvider(country, documentType);
    if (!provider) {
      return {
        success: false,
        verification: this.createFailedVerification(
          userId,
          "GOVERNMENT_ID",
          "No provider available"
        ),
        confidenceScore: 0,
        issues: [
          {
            code: "NO_PROVIDER",
            message: "No verification provider available",
            severity: "error",
          },
        ],
      };
    }

    // Create pending verification record
    const verification = await this.createVerification({
      userId,
      verificationType: "GOVERNMENT_ID",
      status: "IN_PROGRESS",
      provider: provider.name,
      documentType,
      documentCountry: country,
      attempts: attempts + 1,
      maxAttempts: 5,
    });

    try {
      // Call provider
      const result = await provider.verify({
        document: documentFront,
        documentType,
        country,
        additionalDocuments: documentBack ? [documentBack] : undefined,
        metadata,
      });

      // Update verification with result
      verification.providerReference = result.reference;
      verification.confidenceScore = result.confidenceScore;

      if (result.status === "approved") {
        verification.status = "APPROVED";
        verification.verifiedAt = new Date();

        // Store extracted data securely (hashed document numbers)
        if (result.extractedData?.documentNumber) {
          await this.storeDocumentData(
            userId,
            documentType,
            result.extractedData
          );
        }

        // Emit verification event
        this.emitSafetyEvent("verification_approved", userId, {
          verificationType: "GOVERNMENT_ID",
          documentType,
        });

        return {
          success: true,
          verification,
          extractedData: this.sanitizeExtractedData(result.extractedData),
          confidenceScore: result.confidenceScore || 0,
        };
      } else if (result.status === "rejected") {
        verification.status = "REJECTED";
        verification.rejectionReason =
          result.issues?.[0]?.message || "Verification failed";

        this.emitSafetyEvent("verification_rejected", userId, {
          verificationType: "GOVERNMENT_ID",
          documentType,
          reason: verification.rejectionReason,
        });

        return {
          success: false,
          verification,
          confidenceScore: result.confidenceScore || 0,
          issues: result.issues,
        };
      } else {
        verification.status = "NEEDS_REVIEW";

        return {
          success: false,
          verification,
          confidenceScore: result.confidenceScore || 0,
          issues: result.issues || [
            {
              code: "PENDING_REVIEW",
              message: "Verification pending manual review",
              severity: "warning",
            },
          ],
        };
      }
    } catch (error) {
      verification.status = "REJECTED";
      verification.rejectionReason = "Verification system error";

      console.error(
        "[VerificationService] Document verification error:",
        error
      );

      return {
        success: false,
        verification,
        confidenceScore: 0,
        issues: [
          {
            code: "SYSTEM_ERROR",
            message: "Verification system temporarily unavailable",
            severity: "error",
          },
        ],
      };
    }
  }

  private selectProvider(
    country: string,
    documentType: DocumentType
  ): VerificationProvider | null {
    const countryConfig = COUNTRY_CONFIGS[country];
    if (!countryConfig) return this.providers.get("onfido") || null;

    // Try country-specific providers first
    for (const providerName of countryConfig.verificationProviders) {
      const provider = this.providers.get(providerName);
      if (provider && provider.supportedDocuments.includes(documentType)) {
        return provider;
      }
    }

    // Fallback to Onfido
    return this.providers.get("onfido") || null;
  }

  // ---------------------------------------------------------------------------
  // SELFIE & LIVENESS VERIFICATION
  // ---------------------------------------------------------------------------

  async captureSelfie(
    userId: string,
    imageData: Buffer,
    _deviceInfo?: Record<string, any>
  ): Promise<SelfieCapture | null> {
    // Basic image validation
    const imageAnalysis = await this.analyzeImage(imageData);

    if (!imageAnalysis.faceDetected) {
      return null;
    }

    const capture: SelfieCapture = {
      id: this.generateId(),
      userId,
      storagePath: await this.storeSecurely(userId, "selfie", imageData),
      qualityScore: imageAnalysis.qualityScore,
      faceDetected: true,
      multipleFaces: imageAnalysis.multipleFaces,
    };

    if (capture.multipleFaces) {
      console.warn(
        "[VerificationService] Multiple faces detected in selfie for user:",
        userId
      );
    }

    return capture;
  }

  async performLivenessCheck(
    userId: string,
    videoData: Buffer,
    challengeResponse: LivenessChallengeResponse
  ): Promise<LivenessResult> {
    // In production, this would use ML models or a provider like SmileID
    const checks: import("../types/safety.types").LivenessCheck[] = [];
    let totalScore = 0;
    let spoofingDetected = false;

    // Blink detection
    const blinkCheck = this.checkBlink(videoData, challengeResponse.blinkTimes);
    checks.push(blinkCheck);
    totalScore += blinkCheck.score;

    // Head movement detection
    const headCheck = this.checkHeadMovement(
      videoData,
      challengeResponse.headMovements
    );
    checks.push(headCheck);
    totalScore += headCheck.score;

    // Expression check
    const expressionCheck = this.checkExpression(
      videoData,
      challengeResponse.expression
    );
    checks.push(expressionCheck);
    totalScore += expressionCheck.score;

    // Anti-spoofing (2D photo detection, screen reflection, etc.)
    const antiSpoofCheck = this.checkAntiSpoofing(videoData);
    checks.push(antiSpoofCheck);
    totalScore += antiSpoofCheck.score;
    spoofingDetected = !antiSpoofCheck.passed;

    const avgScore = totalScore / checks.length;
    const isLive =
      avgScore >= 0.7 && !spoofingDetected && checks.every((c) => c.passed);

    // Create verification record
    await this.createVerification({
      userId,
      verificationType: "LIVENESS",
      status: isLive ? "APPROVED" : "REJECTED",
      confidenceScore: avgScore,
      verifiedAt: isLive ? new Date() : undefined,
      rejectionReason: !isLive
        ? spoofingDetected
          ? "Spoofing detected"
          : "Liveness check failed"
        : undefined,
    });

    if (isLive) {
      this.emitSafetyEvent("verification_approved", userId, {
        verificationType: "LIVENESS",
      });
    }

    return {
      isLive,
      score: avgScore,
      checks,
      spoofingDetected,
      spoofingType: spoofingDetected ? "photo_presentation" : undefined,
    };
  }

  async matchFaceToDocument(
    userId: string,
    selfieId: string,
    documentId: string
  ): Promise<FaceMatchResult> {
    // Get selfie and document images
    const selfieCapture = await this.getSelfieCapture(selfieId);
    const documentVerification = await this.getVerification(documentId);

    if (!selfieCapture || !documentVerification) {
      return {
        matched: false,
        matchScore: 0,
        threshold: 0.8,
        selfieQuality: 0,
        documentPhotoQuality: 0,
      };
    }

    // In production, this would use facial recognition APIs
    const matchResult = await this.compareFaces(
      selfieCapture.storagePath,
      documentVerification.providerReference || ""
    );

    const threshold = 0.8; // 80% match required
    const matched = matchResult.score >= threshold;

    if (matched) {
      // Create face match verification
      await this.createVerification({
        userId,
        verificationType: "BIOMETRIC",
        status: "APPROVED",
        confidenceScore: matchResult.score,
        verifiedAt: new Date(),
      });
    }

    return {
      matched,
      matchScore: matchResult.score,
      threshold,
      selfieQuality: selfieCapture.qualityScore,
      documentPhotoQuality: matchResult.documentQuality,
    };
  }

  // ---------------------------------------------------------------------------
  // OTP VERIFICATION
  // ---------------------------------------------------------------------------

  async sendPhoneOTP(
    userId: string,
    phoneNumber: string
  ): Promise<{ sent: boolean; expiresIn: number }> {
    // Rate limit check
    const recentOTPs = await this.getRecentOTPCount(userId, "phone");
    if (recentOTPs >= 5) {
      return { sent: false, expiresIn: 0 };
    }

    const otp = this.generateOTP();
    const expiresIn = 300; // 5 minutes

    // Store OTP
    this.otpStore.set(`${userId}:phone`, {
      otp: this.hashOTP(otp),
      type: "phone",
      destination: phoneNumber,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      attempts: 0,
      maxAttempts: 3,
    });

    // Send SMS (in production, use SMS provider)
    await this.sendSMS(
      phoneNumber,
      `Your UBI verification code is: ${otp}. Valid for 5 minutes.`
    );

    console.log(
      "[VerificationService] Phone OTP sent to:",
      phoneNumber.slice(-4)
    );

    return { sent: true, expiresIn };
  }

  async sendEmailOTP(
    userId: string,
    email: string
  ): Promise<{ sent: boolean; expiresIn: number }> {
    // Rate limit check
    const recentOTPs = await this.getRecentOTPCount(userId, "email");
    if (recentOTPs >= 5) {
      return { sent: false, expiresIn: 0 };
    }

    const otp = this.generateOTP();
    const expiresIn = 600; // 10 minutes

    // Store OTP
    this.otpStore.set(`${userId}:email`, {
      otp: this.hashOTP(otp),
      type: "email",
      destination: email,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      attempts: 0,
      maxAttempts: 3,
    });

    // Send email (in production, use email provider)
    await this.sendEmail(
      email,
      "UBI Verification Code",
      `Your verification code is: ${otp}`
    );

    return { sent: true, expiresIn };
  }

  async verifyOTP(
    userId: string,
    type: "phone" | "email",
    code: string
  ): Promise<{ verified: boolean; attemptsRemaining?: number }> {
    const key = `${userId}:${type}`;
    const otpRecord = this.otpStore.get(key);

    if (!otpRecord) {
      return { verified: false };
    }

    if (otpRecord.expiresAt < new Date()) {
      this.otpStore.delete(key);
      return { verified: false };
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      this.otpStore.delete(key);
      return { verified: false, attemptsRemaining: 0 };
    }

    otpRecord.attempts++;

    if (this.hashOTP(code) !== otpRecord.otp) {
      return {
        verified: false,
        attemptsRemaining: otpRecord.maxAttempts - otpRecord.attempts,
      };
    }

    // OTP verified - create verification record
    this.otpStore.delete(key);

    await this.createVerification({
      userId,
      verificationType: type === "phone" ? "PHONE" : "EMAIL",
      status: "APPROVED",
      confidenceScore: 1,
      verifiedAt: new Date(),
    });

    this.emitSafetyEvent("verification_approved", userId, {
      verificationType: type === "phone" ? "PHONE" : "EMAIL",
    });

    return { verified: true };
  }

  // ---------------------------------------------------------------------------
  // DRIVER LICENSE VERIFICATION
  // ---------------------------------------------------------------------------

  async verifyDriversLicense(
    userId: string,
    country: string,
    licenseData: {
      frontImage: Buffer;
      backImage?: Buffer;
      licenseNumber: string;
      expiryDate: string;
    }
  ): Promise<VerificationResult> {
    const countryConfig = COUNTRY_CONFIGS[country];
    if (!countryConfig) {
      return {
        success: false,
        verification: this.createFailedVerification(
          userId,
          "DRIVERS_LICENSE",
          "Unsupported country"
        ),
        confidenceScore: 0,
        issues: [
          {
            code: "UNSUPPORTED_COUNTRY",
            message: "Country not supported",
            severity: "error",
          },
        ],
      };
    }

    // Determine document type based on country
    const documentType = this.getDriversLicenseType(country);

    // Check expiry
    const expiryDate = new Date(licenseData.expiryDate);
    if (expiryDate < new Date()) {
      return {
        success: false,
        verification: this.createFailedVerification(
          userId,
          "DRIVERS_LICENSE",
          "License expired"
        ),
        confidenceScore: 0,
        issues: [
          {
            code: "LICENSE_EXPIRED",
            message: "Driver's license has expired",
            severity: "error",
          },
        ],
      };
    }

    // Submit for verification
    return this.submitDocument({
      userId,
      documentType,
      country,
      documentFront: licenseData.frontImage,
      documentBack: licenseData.backImage,
      metadata: {
        licenseNumber: licenseData.licenseNumber,
        expiryDate: licenseData.expiryDate,
      },
    });
  }

  private getDriversLicenseType(country: string): DocumentType {
    const licenseTypes: Record<string, DocumentType> = {
      NG: "DRIVERS_LICENSE_NG",
      KE: "DRIVERS_LICENSE_KE",
      ZA: "DRIVERS_LICENSE_ZA",
      GH: "DRIVERS_LICENSE_GH",
    };
    return licenseTypes[country] || "DRIVERS_LICENSE_NG";
  }

  // ---------------------------------------------------------------------------
  // VERIFICATION STATUS & HISTORY
  // ---------------------------------------------------------------------------

  async getUserVerifications(userId: string): Promise<UserVerification[]> {
    // In production, this queries the database
    return this.verificationCache.get(userId) || [];
  }

  async getVerificationByType(
    userId: string,
    type: VerificationType
  ): Promise<UserVerification | null> {
    const verifications = await this.getUserVerifications(userId);
    return verifications.find((v) => v.verificationType === type) || null;
  }

  async getVerificationAttempts(
    userId: string,
    type: VerificationType
  ): Promise<number> {
    const verifications = await this.getUserVerifications(userId);
    return verifications
      .filter((v) => v.verificationType === type)
      .reduce((sum, v) => sum + v.attempts, 0);
  }

  async getVerificationStatus(
    userId: string
  ): Promise<VerificationStatusSummary> {
    const verifications = await this.getUserVerifications(userId);
    const level = this.calculateVerificationLevel(verifications);

    const statusMap: Record<
      VerificationType,
      { status: VerificationStatus; verifiedAt?: Date }
    > = {} as any;

    const verificationTypes: VerificationType[] = [
      "PHONE",
      "EMAIL",
      "GOVERNMENT_ID",
      "SELFIE",
      "LIVENESS",
      "DRIVERS_LICENSE",
      "BACKGROUND_CHECK",
      "BIOMETRIC",
    ];

    for (const type of verificationTypes) {
      const v = verifications.find((ver) => ver.verificationType === type);
      statusMap[type] = {
        status: v?.status || "PENDING",
        verifiedAt: v?.verifiedAt,
      };
    }

    return {
      userId,
      currentLevel: level,
      verifications: statusMap,
      canUpgrade: level !== "PREMIUM",
      nextLevelRequirements:
        level !== "PREMIUM"
          ? await this.getNextRequiredVerification(
              userId,
              this.getNextLevel(level)
            )
          : [],
    };
  }

  private getNextLevel(current: VerificationLevel): VerificationLevel {
    const levels: VerificationLevel[] = [
      "BASIC",
      "VERIFIED",
      "DRIVER",
      "MERCHANT",
      "PREMIUM",
    ];
    const currentIndex = levels.indexOf(current);
    return levels[Math.min(currentIndex + 1, levels.length - 1)] || "PREMIUM";
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  private async createVerification(
    data: Partial<UserVerification>
  ): Promise<UserVerification> {
    const verification: UserVerification = {
      id: this.generateId(),
      userId: data.userId!,
      verificationType: data.verificationType!,
      status: data.status || "PENDING",
      provider: data.provider,
      providerReference: data.providerReference,
      documentType: data.documentType,
      documentCountry: data.documentCountry,
      documentExpiry: data.documentExpiry,
      confidenceScore: data.confidenceScore,
      rejectionReason: data.rejectionReason,
      attempts: data.attempts || 1,
      maxAttempts: data.maxAttempts || 5,
      verifiedAt: data.verifiedAt,
      expiresAt: data.expiresAt,
      createdAt: new Date(),
    };

    // Cache the verification
    const existing = this.verificationCache.get(verification.userId) || [];
    existing.push(verification);
    this.verificationCache.set(verification.userId, existing);

    return verification;
  }

  private createFailedVerification(
    userId: string,
    type: VerificationType,
    reason: string
  ): UserVerification {
    return {
      id: this.generateId(),
      userId,
      verificationType: type,
      status: "REJECTED",
      rejectionReason: reason,
      attempts: 0,
      maxAttempts: 5,
      createdAt: new Date(),
    };
  }

  private async getVerification(id: string): Promise<UserVerification | null> {
    for (const [, verifications] of this.verificationCache) {
      const found = verifications.find((v) => v.id === id);
      if (found) return found;
    }
    return null;
  }

  private async getSelfieCapture(_id: string): Promise<SelfieCapture | null> {
    // In production, query database
    return null;
  }

  private sanitizeExtractedData(
    data?: ExtractedDocumentData
  ): ExtractedDocumentData | undefined {
    if (!data) return undefined;

    return {
      ...data,
      documentNumber: data.documentNumber
        ? this.maskDocumentNumber(data.documentNumber)
        : undefined,
    };
  }

  private maskDocumentNumber(number: string): string {
    if (number.length <= 4) return "****";
    return "*".repeat(number.length - 4) + number.slice(-4);
  }

  private async storeDocumentData(
    _userId: string,
    _documentType: DocumentType,
    _data: ExtractedDocumentData
  ): Promise<void> {
    // In production, encrypt and store securely
  }

  private async storeSecurely(
    userId: string,
    type: string,
    _data: Buffer
  ): Promise<string> {
    // In production, encrypt and store in secure storage
    const path = `verifications/${userId}/${type}/${this.generateId()}`;
    return path;
  }

  private async analyzeImage(_imageData: Buffer): Promise<{
    faceDetected: boolean;
    multipleFaces: boolean;
    qualityScore: number;
  }> {
    // In production, use face detection APIs
    return {
      faceDetected: true,
      multipleFaces: false,
      qualityScore: 0.85,
    };
  }

  private checkBlink(
    _videoData: Buffer,
    blinkTimes: number[]
  ): import("../types/safety.types").LivenessCheck {
    // In production, analyze video frames for blinks
    return {
      type: "blink",
      passed: blinkTimes.length >= 2,
      score: blinkTimes.length >= 2 ? 0.9 : 0.3,
      details: `Detected ${blinkTimes.length} blinks`,
    };
  }

  private checkHeadMovement(
    _videoData: Buffer,
    movements: { direction: string; timestamp: number }[]
  ): import("../types/safety.types").LivenessCheck {
    return {
      type: "head_movement",
      passed: movements.length >= 2,
      score: movements.length >= 2 ? 0.9 : 0.3,
    };
  }

  private checkExpression(
    _videoData: Buffer,
    _expression: string
  ): import("../types/safety.types").LivenessCheck {
    return {
      type: "expression",
      passed: true,
      score: 0.85,
    };
  }

  private checkAntiSpoofing(
    _videoData: Buffer
  ): import("../types/safety.types").LivenessCheck {
    // In production, check for:
    // - 2D photo presentation
    // - Screen reflection/moire patterns
    // - Depth consistency
    // - Lighting analysis
    return {
      type: "anti_spoofing",
      passed: true,
      score: 0.9,
    };
  }

  private async compareFaces(
    _selfiePath: string,
    _documentRef: string
  ): Promise<{ score: number; documentQuality: number }> {
    // In production, use facial recognition API
    return {
      score: 0.92,
      documentQuality: 0.88,
    };
  }

  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private hashOTP(otp: string): string {
    return crypto.createHash("sha256").update(otp).digest("hex");
  }

  private async getRecentOTPCount(
    _userId: string,
    _type: string
  ): Promise<number> {
    // In production, query database for recent OTPs
    return 0;
  }

  private async sendSMS(_phoneNumber: string, _message: string): Promise<void> {
    // In production, use SMS provider (Twilio, Africa's Talking, etc.)
  }

  private async sendEmail(
    _email: string,
    _subject: string,
    _body: string
  ): Promise<void> {
    // In production, use email provider
  }

  private generateId(): string {
    return `ver_${crypto.randomBytes(12).toString("hex")}`;
  }

  private emitSafetyEvent(
    eventType: string,
    userId: string,
    metadata?: Record<string, any>
  ): void {
    this.emit("safety_event", {
      eventType,
      userId,
      timestamp: new Date(),
      metadata,
    } as SafetyEvent);
  }
}

// =============================================================================
// VERIFICATION PROVIDER IMPLEMENTATIONS
// =============================================================================

class SmileIDProvider implements VerificationProvider {
  name = "smile_id";
  supportedCountries = ["NG", "KE", "GH", "ZA", "RW", "ET"];
  supportedDocuments: DocumentType[] = [
    "BVN",
    "NIN",
    "NATIONAL_ID_KE",
    "GHANA_CARD",
    "RSA_ID",
    "NATIONAL_ID_RW",
    "NATIONAL_ID_ET",
    "DRIVERS_LICENSE_NG",
    "DRIVERS_LICENSE_KE",
    "DRIVERS_LICENSE_ZA",
    "DRIVERS_LICENSE_GH",
    "PASSPORT",
  ];

  async verify(params: ProviderVerifyParams): Promise<ProviderVerifyResult> {
    // SmileID API integration
    console.log(
      "[SmileID] Verifying document:",
      params.documentType,
      "for country:",
      params.country
    );

    // Simulate API call
    return {
      reference: `smile_${crypto.randomBytes(8).toString("hex")}`,
      status: "approved",
      confidenceScore: 0.95,
      extractedData: {
        fullName: "John Doe",
        dateOfBirth: "1990-01-15",
        documentNumber: "ABC12345678",
      },
    };
  }

  async checkStatus(
    reference: string
  ): Promise<import("../types/safety.types").ProviderStatusResult> {
    return {
      reference,
      status: "approved",
      updatedAt: new Date(),
    };
  }
}

class IPRSProvider implements VerificationProvider {
  name = "iprs";
  supportedCountries = ["KE"];
  supportedDocuments: DocumentType[] = [
    "NATIONAL_ID_KE",
    "KRA_PIN",
    "DRIVERS_LICENSE_KE",
  ];

  async verify(params: ProviderVerifyParams): Promise<ProviderVerifyResult> {
    console.log("[IPRS] Verifying Kenyan document:", params.documentType);

    return {
      reference: `iprs_${crypto.randomBytes(8).toString("hex")}`,
      status: "approved",
      confidenceScore: 0.98,
      extractedData: {
        fullName: "Jane Wanjiku",
        dateOfBirth: "1985-06-20",
        documentNumber: "12345678",
      },
    };
  }

  async checkStatus(
    reference: string
  ): Promise<import("../types/safety.types").ProviderStatusResult> {
    return {
      reference,
      status: "approved",
      updatedAt: new Date(),
    };
  }
}

class XDSProvider implements VerificationProvider {
  name = "xds";
  supportedCountries = ["ZA"];
  supportedDocuments: DocumentType[] = ["RSA_ID", "DRIVERS_LICENSE_ZA"];

  async verify(params: ProviderVerifyParams): Promise<ProviderVerifyResult> {
    console.log("[XDS] Verifying South African document:", params.documentType);

    return {
      reference: `xds_${crypto.randomBytes(8).toString("hex")}`,
      status: "approved",
      confidenceScore: 0.96,
      extractedData: {
        fullName: "Thabo Mbeki",
        dateOfBirth: "1988-03-12",
        documentNumber: "8803125000000",
      },
    };
  }

  async checkStatus(
    reference: string
  ): Promise<import("../types/safety.types").ProviderStatusResult> {
    return {
      reference,
      status: "approved",
      updatedAt: new Date(),
    };
  }
}

class HomeAffairsProvider implements VerificationProvider {
  name = "home_affairs";
  supportedCountries = ["ZA"];
  supportedDocuments: DocumentType[] = ["RSA_ID"];

  async verify(_params: ProviderVerifyParams): Promise<ProviderVerifyResult> {
    console.log("[HomeAffairs] Verifying RSA ID");

    return {
      reference: `dha_${crypto.randomBytes(8).toString("hex")}`,
      status: "approved",
      confidenceScore: 0.99,
    };
  }

  async checkStatus(
    reference: string
  ): Promise<import("../types/safety.types").ProviderStatusResult> {
    return {
      reference,
      status: "approved",
      updatedAt: new Date(),
    };
  }
}

class OnfidoProvider implements VerificationProvider {
  name = "onfido";
  supportedCountries = ["*"]; // Global fallback
  supportedDocuments: DocumentType[] = [
    "PASSPORT",
    "DRIVERS_LICENSE_NG",
    "DRIVERS_LICENSE_KE",
    "DRIVERS_LICENSE_ZA",
    "DRIVERS_LICENSE_GH",
    "RSA_ID",
    "NATIONAL_ID_KE",
    "NIN",
  ];

  async verify(params: ProviderVerifyParams): Promise<ProviderVerifyResult> {
    console.log("[Onfido] Verifying document:", params.documentType);

    return {
      reference: `onfido_${crypto.randomBytes(8).toString("hex")}`,
      status: "approved",
      confidenceScore: 0.9,
      extractedData: {
        fullName: "User Name",
        documentNumber: "DOC123456",
      },
    };
  }

  async checkStatus(
    reference: string
  ): Promise<import("../types/safety.types").ProviderStatusResult> {
    return {
      reference,
      status: "approved",
      updatedAt: new Date(),
    };
  }
}

class YouVerifyProvider implements VerificationProvider {
  name = "youverify";
  supportedCountries = ["NG"];
  supportedDocuments: DocumentType[] = [
    "BVN",
    "NIN",
    "VOTERS_CARD",
    "DRIVERS_LICENSE_NG",
  ];

  async verify(params: ProviderVerifyParams): Promise<ProviderVerifyResult> {
    console.log(
      "[YouVerify] Verifying Nigerian document:",
      params.documentType
    );

    return {
      reference: `yv_${crypto.randomBytes(8).toString("hex")}`,
      status: "approved",
      confidenceScore: 0.94,
      extractedData: {
        fullName: "Chukwuemeka Okafor",
        dateOfBirth: "1992-08-25",
        documentNumber: "22234567890",
      },
    };
  }

  async checkStatus(
    reference: string
  ): Promise<import("../types/safety.types").ProviderStatusResult> {
    return {
      reference,
      status: "approved",
      updatedAt: new Date(),
    };
  }
}

// =============================================================================
// TYPES & CONFIGURATIONS
// =============================================================================

interface OTPRecord {
  otp: string;
  type: "phone" | "email";
  destination: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
}

interface LivenessChallengeResponse {
  blinkTimes: number[];
  headMovements: { direction: string; timestamp: number }[];
  expression: string;
}

interface VerificationStatusSummary {
  userId: string;
  currentLevel: VerificationLevel;
  verifications: Record<
    VerificationType,
    { status: VerificationStatus; verifiedAt?: Date }
  >;
  canUpgrade: boolean;
  nextLevelRequirements: VerificationType[];
}

const VERIFICATION_LEVEL_CONFIGS: Record<
  VerificationLevel,
  VerificationLevelConfig
> = {
  BASIC: {
    level: "BASIC",
    name: "Basic",
    description: "Phone verified",
    requirements: {
      phone: true,
      email: false,
      governmentId: false,
      selfie: false,
      liveness: false,
      driversLicense: false,
      backgroundCheck: false,
      vehicleDocs: false,
      address: false,
    },
    capabilities: {
      canRide: true,
      canDrive: false,
      canSendMoney: true,
      canReceiveMoney: false,
      canAccessEarnings: false,
      canMerchant: false,
      dailyLimit: 50000,
      monthlyLimit: 200000,
    },
    dailyLimit: 50000,
    monthlyLimit: 200000,
  },
  VERIFIED: {
    level: "VERIFIED",
    name: "Verified",
    description: "ID and face verified",
    requirements: {
      phone: true,
      email: true,
      governmentId: true,
      selfie: true,
      liveness: true,
      driversLicense: false,
      backgroundCheck: false,
      vehicleDocs: false,
      address: false,
    },
    capabilities: {
      canRide: true,
      canDrive: false,
      canSendMoney: true,
      canReceiveMoney: true,
      canAccessEarnings: false,
      canMerchant: false,
      dailyLimit: 500000,
      monthlyLimit: 2000000,
    },
    dailyLimit: 500000,
    monthlyLimit: 2000000,
  },
  DRIVER: {
    level: "DRIVER",
    name: "Driver",
    description: "Full driver verification",
    requirements: {
      phone: true,
      email: true,
      governmentId: true,
      selfie: true,
      liveness: true,
      driversLicense: true,
      backgroundCheck: true,
      vehicleDocs: true,
      address: false,
    },
    capabilities: {
      canRide: true,
      canDrive: true,
      canSendMoney: true,
      canReceiveMoney: true,
      canAccessEarnings: true,
      canMerchant: false,
      dailyLimit: 1000000,
      monthlyLimit: 5000000,
    },
    dailyLimit: 1000000,
    monthlyLimit: 5000000,
  },
  MERCHANT: {
    level: "MERCHANT",
    name: "Merchant",
    description: "Business verification",
    requirements: {
      phone: true,
      email: true,
      governmentId: true,
      selfie: true,
      liveness: true,
      driversLicense: false,
      backgroundCheck: false,
      vehicleDocs: false,
      address: true,
    },
    capabilities: {
      canRide: true,
      canDrive: false,
      canSendMoney: true,
      canReceiveMoney: true,
      canAccessEarnings: true,
      canMerchant: true,
      dailyLimit: 5000000,
      monthlyLimit: 20000000,
    },
    dailyLimit: 5000000,
    monthlyLimit: 20000000,
  },
  PREMIUM: {
    level: "PREMIUM",
    name: "Premium",
    description: "Full biometric verification",
    requirements: {
      phone: true,
      email: true,
      governmentId: true,
      selfie: true,
      liveness: true,
      driversLicense: true,
      backgroundCheck: true,
      vehicleDocs: true,
      address: true,
    },
    capabilities: {
      canRide: true,
      canDrive: true,
      canSendMoney: true,
      canReceiveMoney: true,
      canAccessEarnings: true,
      canMerchant: true,
      dailyLimit: 10000000,
      monthlyLimit: 50000000,
    },
    dailyLimit: 10000000,
    monthlyLimit: 50000000,
  },
};

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const verificationService = new VerificationService();
