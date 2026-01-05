/**
 * UBI Safety Fraud Detection Service
 *
 * Comprehensive fraud prevention for safety-critical scenarios:
 * - Account Takeover (ATO) detection
 * - Device fingerprinting & trust scoring
 * - Promo/referral abuse detection
 * - Fake driver/trip detection
 * - Collusion detection (driver-rider rings)
 * - GPS spoofing detection
 * - Velocity rule engine
 * - Risk scoring & decisioning
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import {
  ATODetection,
  ATOSignal,
  AbuseDetection,
  AbuseSignal,
  CollusionDetection,
  DeviceFingerprint,
  DeviceInfo,
  FakeDriverDetection,
  FakeDriverSignal,
  FraudActionType,
  FraudEvent,
  Location,
  RiskAssessment,
  RiskLevel,
  RiskSignal,
  UserRiskProfile,
} from "../types/safety.types";

// =============================================================================
// SAFETY FRAUD DETECTION SERVICE
// =============================================================================

export class SafetyFraudService extends EventEmitter {
  private deviceFingerprints: Map<string, DeviceFingerprint[]> = new Map(); // userId -> devices
  private userRiskProfiles: Map<string, UserRiskProfile> = new Map();
  private fraudEvents: Map<string, FraudEventRecord[]> = new Map();
  private velocityTrackers: Map<string, VelocityData[]> = new Map();
  private promoUsage: Map<string, PromoUsageRecord[]> = new Map();
  private tripPatterns: Map<string, TripPatternRecord[]> = new Map();

  // Thresholds
  private readonly ATO_RISK_THRESHOLD = 0.7;
  private readonly ABUSE_RISK_THRESHOLD = 0.6;
  private readonly COLLUSION_THRESHOLD = 0.8;

  constructor() {
    super();
    this.startPeriodicAnalysis();
  }

  // ---------------------------------------------------------------------------
  // RISK ASSESSMENT
  // ---------------------------------------------------------------------------

  async assessRisk(event: FraudEvent): Promise<RiskAssessment> {
    const { userId, eventType, deviceInfo, ipAddress, geoLocation } = event;

    const signals: RiskSignal[] = [];
    let totalScore = 0;

    // Device analysis
    if (deviceInfo) {
      const deviceSignals = await this.analyzeDevice(userId, deviceInfo);
      signals.push(...deviceSignals);
      totalScore += deviceSignals.reduce((sum, s) => sum + s.score, 0);
    }

    // Location analysis
    if (geoLocation) {
      const locationSignals = await this.analyzeLocation(userId, geoLocation);
      signals.push(...locationSignals);
      totalScore += locationSignals.reduce((sum, s) => sum + s.score, 0);
    }

    // IP analysis
    if (ipAddress) {
      const ipSignals = await this.analyzeIP(userId, ipAddress);
      signals.push(...ipSignals);
      totalScore += ipSignals.reduce((sum, s) => sum + s.score, 0);
    }

    // Behavioral analysis
    const behaviorSignals = await this.analyzeBehavior(userId, eventType);
    signals.push(...behaviorSignals);
    totalScore += behaviorSignals.reduce((sum, s) => sum + s.score, 0);

    // Velocity check
    const velocitySignals = await this.checkVelocity(userId, eventType);
    signals.push(...velocitySignals);
    totalScore += velocitySignals.reduce((sum, s) => sum + s.score, 0);

    // Normalize score
    const normalizedScore = Math.min(totalScore / 100, 1);
    const riskLevel = this.scoreToRiskLevel(normalizedScore);
    const recommendation = this.getRecommendation(normalizedScore, signals);
    const requiresChallenge = normalizedScore > 0.5 && normalizedScore < 0.8;

    // Record fraud event
    await this.recordFraudEvent(userId, event, signals, normalizedScore);

    // Update user risk profile
    await this.updateRiskProfile(userId, normalizedScore, signals);

    const assessment: RiskAssessment = {
      score: normalizedScore,
      level: riskLevel,
      signals,
      recommendation,
      requiresChallenge,
      challengeType: requiresChallenge
        ? this.selectChallengeType(signals)
        : undefined,
    };

    // Emit event for high risk
    if (normalizedScore >= 0.7) {
      this.emit("high_risk_detected", { userId, assessment, event });
    }

    return assessment;
  }

  // ---------------------------------------------------------------------------
  // ACCOUNT TAKEOVER DETECTION
  // ---------------------------------------------------------------------------

  async detectAccountTakeover(
    userId: string,
    _eventType: string,
    deviceInfo?: DeviceInfo
  ): Promise<ATODetection> {
    const signals: ATOSignal[] = [];
    let riskScore = 0;

    // Check for recent phone change
    const recentPhoneChange = await this.checkRecentPhoneChange(userId);
    if (recentPhoneChange) {
      signals.push({
        type: "recent_phone_change",
        severity: "high",
        details: {
          daysAgo: recentPhoneChange.daysAgo,
          previousPhone: recentPhoneChange.previous,
        },
      });
      riskScore += 30;
    }

    // Check for recent password reset
    const recentPasswordReset = await this.checkRecentPasswordReset(userId);
    if (recentPasswordReset) {
      signals.push({
        type: "recent_password_reset",
        severity: "medium",
        details: { daysAgo: recentPasswordReset.daysAgo },
      });
      riskScore += 20;
    }

    // Check if new device
    if (deviceInfo) {
      const isNewDevice = await this.isNewDevice(userId, deviceInfo);
      if (isNewDevice) {
        signals.push({
          type: "new_device",
          severity: "medium",
          details: {
            deviceType: deviceInfo.deviceType,
            model: deviceInfo.model,
          },
        });
        riskScore += 15;
      }
    }

    // Check impossible travel
    const impossibleTravel = await this.detectImpossibleTravel(userId);
    if (impossibleTravel) {
      signals.push({
        type: "impossible_travel",
        severity: "high",
        details: impossibleTravel,
      });
      riskScore += 35;
    }

    // Check SIM swap (would integrate with telco APIs)
    const simSwap = await this.detectSIMSwap(userId);
    if (simSwap) {
      signals.push({
        type: "sim_swap",
        severity: "high",
        details: { detected: true },
      });
      riskScore += 40;
    }

    const normalizedScore = Math.min(riskScore / 100, 1);

    // Combine signals
    if (signals.length >= 2 || normalizedScore >= this.ATO_RISK_THRESHOLD) {
      this.emit("ato_suspected", {
        userId,
        signals,
        riskScore: normalizedScore,
      });
    }

    return {
      detected: normalizedScore >= this.ATO_RISK_THRESHOLD,
      signals,
      recommendation: this.getATORecommendation(normalizedScore),
      riskScore: normalizedScore,
    };
  }

  private getATORecommendation(
    score: number
  ): "allow" | "challenge" | "block_and_verify" {
    if (score >= 0.8) return "block_and_verify";
    if (score >= 0.5) return "challenge";
    return "allow";
  }

  // ---------------------------------------------------------------------------
  // DEVICE ANALYSIS
  // ---------------------------------------------------------------------------

  async registerDevice(
    userId: string,
    deviceInfo: DeviceInfo
  ): Promise<DeviceFingerprint> {
    const existingDevices = this.deviceFingerprints.get(userId) || [];

    // Check if device already registered
    const existing = existingDevices.find(
      (d) => d.deviceId === deviceInfo.deviceId
    );
    if (existing) {
      existing.lastSeenAt = new Date();
      return existing;
    }

    // Calculate initial trust score
    const trustScore = await this.calculateDeviceTrustScore(deviceInfo);
    const riskFlags = this.detectDeviceRiskFlags(deviceInfo);

    const fingerprint: DeviceFingerprint = {
      ...deviceInfo,
      id: this.generateId(),
      userId,
      trustScore,
      riskFlags,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    };

    existingDevices.push(fingerprint);
    this.deviceFingerprints.set(userId, existingDevices);

    // Flag multi-device if many devices
    if (existingDevices.length > 3) {
      this.emit("multi_device_alert", {
        userId,
        deviceCount: existingDevices.length,
      });
    }

    return fingerprint;
  }

  async analyzeDevice(
    userId: string,
    deviceInfo: DeviceInfo
  ): Promise<RiskSignal[]> {
    const signals: RiskSignal[] = [];

    // Check if emulator
    if (deviceInfo.isEmulator) {
      signals.push({
        type: "EMULATOR",
        severity: "critical",
        score: 40,
        details: { platform: deviceInfo.platform },
        timestamp: new Date(),
      });
    }

    // Check if rooted/jailbroken
    if (deviceInfo.isRooted) {
      signals.push({
        type: "DEVICE_REPUTATION",
        severity: "high",
        score: 25,
        details: { reason: "rooted_device" },
        timestamp: new Date(),
      });
    }

    // Check mock location
    if (deviceInfo.hasMockLocation) {
      signals.push({
        type: "FAKE_GPS",
        severity: "critical",
        score: 40,
        details: { hasMockLocation: true },
        timestamp: new Date(),
      });
    }

    // Check VPN
    if (deviceInfo.hasVpn) {
      signals.push({
        type: "IP_REPUTATION",
        severity: "medium",
        score: 15,
        details: { hasVpn: true },
        timestamp: new Date(),
      });
    }

    // Check if new device
    const isNew = await this.isNewDevice(userId, deviceInfo);
    if (isNew) {
      signals.push({
        type: "NEW_DEVICE",
        severity: "medium",
        score: 15,
        details: { deviceType: deviceInfo.deviceType },
        timestamp: new Date(),
      });
    }

    return signals;
  }

  private async calculateDeviceTrustScore(
    deviceInfo: DeviceInfo
  ): Promise<number> {
    let score = 100;

    if (deviceInfo.isEmulator) score -= 50;
    if (deviceInfo.isRooted) score -= 30;
    if (deviceInfo.hasMockLocation) score -= 40;
    if (deviceInfo.hasVpn) score -= 10;

    return Math.max(score / 100, 0);
  }

  private detectDeviceRiskFlags(deviceInfo: DeviceInfo): string[] {
    const flags: string[] = [];

    if (deviceInfo.isEmulator) flags.push("emulator");
    if (deviceInfo.isRooted) flags.push("rooted");
    if (deviceInfo.hasMockLocation) flags.push("mock_location");
    if (deviceInfo.hasVpn) flags.push("vpn");

    return flags;
  }

  private async isNewDevice(
    userId: string,
    deviceInfo: DeviceInfo
  ): Promise<boolean> {
    const devices = this.deviceFingerprints.get(userId) || [];
    return !devices.some((d) => d.deviceId === deviceInfo.deviceId);
  }

  // ---------------------------------------------------------------------------
  // PROMO & REFERRAL ABUSE DETECTION
  // ---------------------------------------------------------------------------

  async detectPromoAbuse(
    userId: string,
    _promoCode: string
  ): Promise<AbuseDetection> {
    const signals: AbuseSignal[] = [];
    let abuseScore = 0;

    // Check multi-account device
    const deviceUsage = await this.checkMultiAccountDevice(userId);
    if (deviceUsage.multiAccount) {
      signals.push({
        type: "multi_account_device",
        severity: "high",
        details: { accountsOnDevice: deviceUsage.accountCount },
      });
      abuseScore += 30;
    }

    // Check circular referral
    const circular = await this.detectCircularReferral(userId);
    if (circular.detected) {
      signals.push({
        type: "circular_referral",
        severity: "critical",
        details: { chain: circular.chain },
      });
      abuseScore += 50;
    }

    // Check excessive promo usage
    const promoHistory = this.promoUsage.get(userId) || [];
    const recentPromos = promoHistory.filter(
      (p) => Date.now() - p.usedAt.getTime() < 30 * 24 * 60 * 60 * 1000 // Last 30 days
    );

    if (recentPromos.length > 10) {
      signals.push({
        type: "excessive_promo_usage",
        severity: "medium",
        details: { count: recentPromos.length, period: "30_days" },
      });
      abuseScore += 20;
    }

    // Check velocity abuse
    const velocityAbuse = await this.checkPromoVelocity(userId);
    if (velocityAbuse) {
      signals.push({
        type: "velocity_abuse",
        severity: "high",
        details: velocityAbuse,
      });
      abuseScore += 25;
    }

    const normalizedScore = Math.min(abuseScore / 100, 1);

    return {
      detected: normalizedScore >= this.ABUSE_RISK_THRESHOLD,
      signals,
      recommendation: this.getAbuseRecommendation(normalizedScore),
      abuseScore: normalizedScore,
    };
  }

  async recordPromoUsage(
    userId: string,
    promoCode: string,
    amount: number
  ): Promise<void> {
    const usage = this.promoUsage.get(userId) || [];
    usage.push({
      promoCode,
      amount,
      usedAt: new Date(),
    });
    this.promoUsage.set(userId, usage);
  }

  private async checkMultiAccountDevice(
    _userId: string
  ): Promise<{ multiAccount: boolean; accountCount: number }> {
    // In production, check device-to-account mapping
    return { multiAccount: false, accountCount: 1 };
  }

  private async detectCircularReferral(
    _userId: string
  ): Promise<{ detected: boolean; chain?: string[] }> {
    // In production, trace referral chain
    return { detected: false };
  }

  private async checkPromoVelocity(
    userId: string
  ): Promise<Record<string, any> | null> {
    const usage = this.promoUsage.get(userId) || [];
    const last24h = usage.filter(
      (p) => Date.now() - p.usedAt.getTime() < 24 * 60 * 60 * 1000
    );

    if (last24h.length > 5) {
      return { count: last24h.length, period: "24h" } as Record<string, any>;
    }

    return null;
  }

  private getAbuseRecommendation(
    score: number
  ): "allow" | "block_promo" | "flag_account" | "suspend" {
    if (score >= 0.9) return "suspend";
    if (score >= 0.7) return "flag_account";
    if (score >= 0.5) return "block_promo";
    return "allow";
  }

  // ---------------------------------------------------------------------------
  // FAKE DRIVER DETECTION
  // ---------------------------------------------------------------------------

  async detectFakeDriver(driverId: string): Promise<FakeDriverDetection> {
    const signals: FakeDriverSignal[] = [];
    let suspicionScore = 0;

    const patterns = this.tripPatterns.get(driverId) || [];

    // Check excessive short trips
    const shortTrips = patterns.filter((p) => p.durationMinutes < 5);
    if (shortTrips.length > 20 && shortTrips.length / patterns.length > 0.5) {
      signals.push({
        type: "excessive_short_trips",
        severity: "high",
        details: {
          shortTripCount: shortTrips.length,
          percentage: shortTrips.length / patterns.length,
        },
      });
      suspicionScore += 30;
    }

    // Check repeated pickup/dropoff locations
    const repeatedLocations = await this.checkRepeatedLocations(
      driverId,
      patterns
    );
    if (repeatedLocations) {
      signals.push({
        type: "repeated_locations",
        severity: "high",
        details: repeatedLocations,
      });
      suspicionScore += 25;
    }

    // Check rider collusion
    const riderCollusion = await this.checkRiderCollusion(driverId, patterns);
    if (riderCollusion.detected) {
      signals.push({
        type: "rider_collusion",
        severity: "critical",
        details: { repeatedRiders: riderCollusion.riders },
      });
      suspicionScore += 40;
    }

    // Check GPS spoofing patterns
    const gpsSpoofing = await this.detectGPSSpoofing(driverId);
    if (gpsSpoofing.detected) {
      signals.push({
        type: "gps_spoofing",
        severity: "critical",
        details: gpsSpoofing.details || {},
      });
      suspicionScore += 50;
    }

    const normalizedScore = Math.min(suspicionScore / 100, 1);

    if (normalizedScore >= 0.6) {
      this.emit("fake_driver_suspected", {
        driverId,
        signals,
        score: normalizedScore,
      });
    }

    return {
      detected: normalizedScore >= 0.6,
      signals,
      recommendation: this.getFakeDriverRecommendation(normalizedScore),
      suspicionScore: normalizedScore,
    };
  }

  private async checkRepeatedLocations(
    _driverId: string,
    _patterns: TripPatternRecord[]
  ): Promise<Record<string, any> | null> {
    // Group by location (within 100m)
    // In production, use actual clustering
    return null;
  }

  private async checkRiderCollusion(
    _driverId: string,
    patterns: TripPatternRecord[]
  ): Promise<{ detected: boolean; riders?: string[] }> {
    const riderCounts: Record<string, number> = {};

    for (const trip of patterns) {
      riderCounts[trip.riderId] = (riderCounts[trip.riderId] || 0) + 1;
    }

    const suspiciousRiders = Object.entries(riderCounts)
      .filter(([, count]) => count > 5)
      .map(([riderId]) => riderId);

    return {
      detected: suspiciousRiders.length > 0,
      riders: suspiciousRiders.length > 0 ? suspiciousRiders : undefined,
    };
  }

  private async detectGPSSpoofing(
    _driverId: string
  ): Promise<{ detected: boolean; details?: Record<string, any> }> {
    // In production, analyze location data for spoofing patterns:
    // - Perfect circles
    // - Impossible speeds
    // - Location jumping
    // - Mock location flag from device
    return { detected: false };
  }

  private getFakeDriverRecommendation(
    score: number
  ): "clear" | "investigate" | "suspend" {
    if (score >= 0.8) return "suspend";
    if (score >= 0.5) return "investigate";
    return "clear";
  }

  async recordTripPattern(
    driverId: string,
    pattern: TripPatternRecord
  ): Promise<void> {
    const patterns = this.tripPatterns.get(driverId) || [];
    patterns.push(pattern);
    this.tripPatterns.set(driverId, patterns);
  }

  // ---------------------------------------------------------------------------
  // COLLUSION DETECTION
  // ---------------------------------------------------------------------------

  async detectCollusion(suspectIds: string[]): Promise<CollusionDetection> {
    const connections: CollusionConnection[] = [];

    // Analyze trip patterns between suspects
    for (let i = 0; i < suspectIds.length; i++) {
      for (let j = i + 1; j < suspectIds.length; j++) {
        const shared = await this.findSharedTrips(
          suspectIds[i] ?? "",
          suspectIds[j] ?? ""
        );
        if (shared && shared.count > 3) {
          connections.push({
            user1: suspectIds[i] ?? "",
            user2: suspectIds[j] ?? "",
            tripCount: shared.count,
            evidenceStrength: shared.count / 10,
          });
        }
      }
    }

    // Analyze device sharing
    const deviceSharing = await this.analyzeDeviceSharing(suspectIds);

    // Analyze referral chains
    const referralChain = await this.analyzeReferralChain(suspectIds);

    const evidenceScore = this.calculateCollusionScore(
      connections,
      deviceSharing,
      referralChain
    );

    let collusionType: CollusionDetection["collusionType"] = "driver_rider";
    if (connections.length > 3) {
      collusionType = "organized_fraud";
    } else if (connections.some((c) => c.tripCount > 10)) {
      collusionType = "multi_driver";
    }

    if (evidenceScore >= this.COLLUSION_THRESHOLD) {
      this.emit("collusion_detected", {
        type: collusionType,
        participants: suspectIds,
        evidenceScore,
      });
    }

    return {
      detected: evidenceScore >= this.COLLUSION_THRESHOLD,
      collusionType,
      participants: suspectIds,
      evidenceScore,
      tripIds: [], // Would include actual trip IDs in production
    };
  }

  private async findSharedTrips(
    _userId1: string,
    _userId2: string
  ): Promise<{ count: number } | null> {
    // In production, query trip database
    return { count: 0 };
  }

  private async analyzeDeviceSharing(userIds: string[]): Promise<boolean> {
    // Check if any users share devices
    const deviceSets: Set<string>[] = userIds.map((userId) => {
      const devices = this.deviceFingerprints.get(userId) || [];
      return new Set(devices.map((d) => d.deviceId));
    });

    for (let i = 0; i < deviceSets.length; i++) {
      for (let j = i + 1; j < deviceSets.length; j++) {
        const setI = deviceSets[i];
        const setJ = deviceSets[j];
        if (setI && setJ) {
          for (const device of setI) {
            if (setJ.has(device)) return true;
          }
        }
      }
    }

    return false;
  }

  private async analyzeReferralChain(_userIds: string[]): Promise<boolean> {
    // Check if users are connected through referrals
    return false;
  }

  private calculateCollusionScore(
    connections: CollusionConnection[],
    deviceSharing: boolean,
    referralChain: boolean
  ): number {
    let score = 0;

    if (connections.length > 0) {
      score += Math.min(connections.length * 10, 40);
      score += connections.reduce((sum, c) => sum + c.evidenceStrength * 10, 0);
    }

    if (deviceSharing) score += 30;
    if (referralChain) score += 20;

    return Math.min(score / 100, 1);
  }

  // ---------------------------------------------------------------------------
  // VELOCITY RULES
  // ---------------------------------------------------------------------------

  async checkVelocity(
    userId: string,
    eventType: string
  ): Promise<RiskSignal[]> {
    const signals: RiskSignal[] = [];

    const velocityData = this.velocityTrackers.get(userId) || [];
    velocityData.push({
      eventType,
      timestamp: new Date(),
    });

    // Keep last 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentData = velocityData.filter(
      (d) => d.timestamp.getTime() > cutoff
    );
    this.velocityTrackers.set(userId, recentData);

    // Check login velocity
    const loginCount = recentData.filter((d) => d.eventType === "login").length;
    if (loginCount > 10) {
      signals.push({
        type: "VELOCITY_BREACH",
        severity: "high",
        score: 25,
        details: { eventType: "login", count: loginCount, period: "24h" },
        timestamp: new Date(),
      });
    }

    // Check payment velocity
    const paymentCount = recentData.filter(
      (d) => d.eventType === "payment"
    ).length;
    if (paymentCount > 20) {
      signals.push({
        type: "VELOCITY_BREACH",
        severity: "medium",
        score: 15,
        details: { eventType: "payment", count: paymentCount, period: "24h" },
        timestamp: new Date(),
      });
    }

    // Check failed payment velocity
    const failedPayments = recentData.filter(
      (d) => d.eventType === "payment_failed"
    ).length;
    if (failedPayments > 5) {
      signals.push({
        type: "VELOCITY_BREACH",
        severity: "high",
        score: 30,
        details: {
          eventType: "payment_failed",
          count: failedPayments,
          period: "24h",
        },
        timestamp: new Date(),
      });
    }

    return signals;
  }

  // ---------------------------------------------------------------------------
  // LOCATION ANALYSIS
  // ---------------------------------------------------------------------------

  private async analyzeLocation(
    userId: string,
    _location: Location
  ): Promise<RiskSignal[]> {
    const signals: RiskSignal[] = [];

    // Check impossible travel
    const impossibleTravel = await this.detectImpossibleTravel(userId);
    if (impossibleTravel) {
      signals.push({
        type: "IMPOSSIBLE_TRAVEL",
        severity: "high",
        score: 35,
        details: impossibleTravel,
        timestamp: new Date(),
      });
    }

    return signals;
  }

  private async detectImpossibleTravel(
    _userId: string
  ): Promise<Record<string, any> | null> {
    // In production, check recent locations for impossible travel speed
    return null;
  }

  // ---------------------------------------------------------------------------
  // IP ANALYSIS
  // ---------------------------------------------------------------------------

  private async analyzeIP(
    _userId: string,
    ipAddress: string
  ): Promise<RiskSignal[]> {
    const signals: RiskSignal[] = [];

    // In production, check IP reputation services
    const ipRisk = await this.checkIPReputation(ipAddress);

    if (ipRisk.isProxy || ipRisk.isVpn || ipRisk.isTor) {
      signals.push({
        type: "IP_REPUTATION",
        severity: "medium",
        score: 15,
        details: {
          isProxy: ipRisk.isProxy,
          isVpn: ipRisk.isVpn,
          isTor: ipRisk.isTor,
        },
        timestamp: new Date(),
      });
    }

    if (ipRisk.isDatacenter) {
      signals.push({
        type: "IP_REPUTATION",
        severity: "high",
        score: 25,
        details: { isDatacenter: true },
        timestamp: new Date(),
      });
    }

    return signals;
  }

  private async checkIPReputation(
    _ipAddress: string
  ): Promise<IPReputationResult> {
    // In production, call IP reputation service (MaxMind, IPQualityScore, etc.)
    return {
      isProxy: false,
      isVpn: false,
      isTor: false,
      isDatacenter: false,
    };
  }

  // ---------------------------------------------------------------------------
  // BEHAVIORAL ANALYSIS
  // ---------------------------------------------------------------------------

  private async analyzeBehavior(
    _userId: string,
    _eventType: string
  ): Promise<RiskSignal[]> {
    const signals: RiskSignal[] = [];

    // In production, use ML models for behavioral analysis
    // - Typing patterns
    // - Navigation patterns
    // - Transaction patterns
    // - Time of activity

    return signals;
  }

  // ---------------------------------------------------------------------------
  // SIM SWAP DETECTION
  // ---------------------------------------------------------------------------

  private async detectSIMSwap(_userId: string): Promise<boolean> {
    // In production, integrate with telco APIs
    // - Africa's Talking
    // - Twilio Lookup
    // - Direct telco integration
    return false;
  }

  // ---------------------------------------------------------------------------
  // RISK PROFILE MANAGEMENT
  // ---------------------------------------------------------------------------

  async getUserRiskProfile(userId: string): Promise<UserRiskProfile> {
    let profile = this.userRiskProfiles.get(userId);

    if (!profile) {
      profile = this.createDefaultRiskProfile(userId);
      this.userRiskProfiles.set(userId, profile);
    }

    return profile;
  }

  private createDefaultRiskProfile(userId: string): UserRiskProfile {
    return {
      userId,
      overallRiskScore: 0,
      riskLevel: "LOW",
      verificationLevel: "BASIC",
      accountAge: 0,
      fraudEventsCount: 0,
      promoAbuseFlags: 0,
      deviceCount: 0,
      isUnderReview: false,
      isRestricted: false,
      isSuspended: false,
    };
  }

  private async updateRiskProfile(
    userId: string,
    newScore: number,
    _signals: RiskSignal[]
  ): Promise<void> {
    const profile = await this.getUserRiskProfile(userId);

    // Weighted average with historical score
    profile.overallRiskScore = profile.overallRiskScore * 0.7 + newScore * 0.3;
    profile.riskLevel = this.scoreToRiskLevel(profile.overallRiskScore);

    // Update counts
    profile.fraudEventsCount++;
    profile.deviceCount = (this.deviceFingerprints.get(userId) || []).length;

    // Check if should flag for review
    if (profile.overallRiskScore > 0.6 && !profile.isUnderReview) {
      profile.isUnderReview = true;
      this.emit("account_flagged", {
        userId,
        reason: "high_risk_score",
        score: profile.overallRiskScore,
      });
    }

    // Check if should restrict
    if (profile.overallRiskScore > 0.8 && !profile.isRestricted) {
      profile.isRestricted = true;
      this.emit("account_restricted", {
        userId,
        reason: "critical_risk_score",
        score: profile.overallRiskScore,
      });
    }

    this.userRiskProfiles.set(userId, profile);
  }

  async restrictAccount(userId: string, reason: string): Promise<void> {
    const profile = await this.getUserRiskProfile(userId);
    profile.isRestricted = true;
    this.userRiskProfiles.set(userId, profile);

    this.emit("account_restricted", { userId, reason });
    console.log(
      "[FraudService] Account restricted:",
      userId,
      "Reason:",
      reason
    );
  }

  async suspendAccount(userId: string, reason: string): Promise<void> {
    const profile = await this.getUserRiskProfile(userId);
    profile.isSuspended = true;
    profile.isRestricted = true;
    this.userRiskProfiles.set(userId, profile);

    this.emit("account_suspended", { userId, reason });
    console.log("[FraudService] Account suspended:", userId, "Reason:", reason);
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  private scoreToRiskLevel(score: number): RiskLevel {
    if (score >= 0.9) return "CRITICAL";
    if (score >= 0.8) return "VERY_HIGH";
    if (score >= 0.6) return "HIGH";
    if (score >= 0.4) return "MEDIUM";
    if (score >= 0.2) return "LOW";
    return "VERY_LOW";
  }

  private getRecommendation(
    score: number,
    _signals: RiskSignal[]
  ): FraudActionType {
    if (score >= 0.9) return "TERMINATE";
    if (score >= 0.8) return "SUSPEND";
    if (score >= 0.7) return "RESTRICT";
    if (score >= 0.6) return "FLAG_FOR_REVIEW";
    if (score >= 0.4) return "CHALLENGE";
    if (score >= 0.2) return "ALLOW";
    return "ALLOW";
  }

  private selectChallengeType(
    signals: RiskSignal[]
  ): "otp" | "biometric" | "security_question" {
    const hasHighSeverity = signals.some(
      (s) => s.severity === "high" || s.severity === "critical"
    );
    const hasDeviceRisk = signals.some((s) =>
      ["NEW_DEVICE", "DEVICE_REPUTATION", "EMULATOR"].includes(s.type)
    );

    if (hasHighSeverity || hasDeviceRisk) return "biometric";
    return "otp";
  }

  private async recordFraudEvent(
    userId: string,
    event: FraudEvent,
    signals: RiskSignal[],
    score: number
  ): Promise<void> {
    const events = this.fraudEvents.get(userId) || [];
    events.push({
      id: this.generateId(),
      event,
      signals,
      score,
      timestamp: new Date(),
    });
    this.fraudEvents.set(userId, events);
  }

  private async checkRecentPhoneChange(
    _userId: string
  ): Promise<{ daysAgo: number; previous: string } | null> {
    // In production, check user change history
    return null;
  }

  private async checkRecentPasswordReset(
    _userId: string
  ): Promise<{ daysAgo: number } | null> {
    // In production, check auth event history
    return null;
  }

  private generateId(): string {
    return `fraud_${crypto.randomBytes(12).toString("hex")}`;
  }

  private startPeriodicAnalysis(): void {
    // Run background analysis every hour
    setInterval(
      () => {
        this.runBackgroundAnalysis();
      },
      60 * 60 * 1000
    );
  }

  private async runBackgroundAnalysis(): Promise<void> {
    console.log("[FraudService] Running background fraud analysis...");

    // Analyze trip patterns for collusion
    // Update risk profiles
    // Clean old data
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface FraudEventRecord {
  id: string;
  event: FraudEvent;
  signals: RiskSignal[];
  score: number;
  timestamp: Date;
}

interface VelocityData {
  eventType: string;
  timestamp: Date;
}

interface PromoUsageRecord {
  promoCode: string;
  amount: number;
  usedAt: Date;
}

interface TripPatternRecord {
  tripId: string;
  riderId: string;
  pickupLocation: Location;
  dropoffLocation: Location;
  durationMinutes: number;
  distanceMeters: number;
  fare: number;
  completedAt: Date;
}

interface CollusionConnection {
  user1: string;
  user2: string;
  tripCount: number;
  evidenceStrength: number;
}

interface IPReputationResult {
  isProxy: boolean;
  isVpn: boolean;
  isTor: boolean;
  isDatacenter: boolean;
}

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const safetyFraudService = new SafetyFraudService();
