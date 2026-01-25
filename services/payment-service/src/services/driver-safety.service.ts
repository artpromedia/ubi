/**
 * UBI Driver Safety Service
 *
 * Driver-specific safety management:
 * - Driver safety profiles & scoring
 * - High-risk zone management
 * - Cash trip safety
 * - Driver incident reporting
 * - Safety recommendations
 * - Fatigue monitoring
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { driverLogger } from "../lib/logger";
import {
  DriverIncident,
  DriverSafetyProfile,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  Location,
  RiskLevel,
  RiskZone,
} from "../types/safety.types";

// =============================================================================
// DRIVER SAFETY SERVICE
// =============================================================================

export class DriverSafetyService extends EventEmitter {
  private driverProfiles: Map<string, DriverSafetyProfile> = new Map();
  private riskZones: Map<string, RiskZone> = new Map();
  private driverIncidents: Map<string, DriverIncident[]> = new Map();
  private drivingHistory: Map<string, DrivingSession[]> = new Map();
  private fatigueAlerts: Map<string, FatigueAlert[]> = new Map();

  // Thresholds
  private readonly MAX_CONTINUOUS_DRIVING_HOURS = 10;
  // private readonly _MIN_REST_BREAK_MINUTES = 30;
  private readonly MAX_WEEKLY_HOURS = 60;
  private readonly SPEEDING_THRESHOLD_KMH = 120;
  private readonly HARD_BRAKE_THRESHOLD_G = 0.5;

  constructor() {
    super();
    this.initializeRiskZones();
  }

  // ---------------------------------------------------------------------------
  // DRIVER SAFETY PROFILE
  // ---------------------------------------------------------------------------

  async getDriverSafetyProfile(driverId: string): Promise<DriverSafetyProfile> {
    let profile = this.driverProfiles.get(driverId);

    if (!profile) {
      profile = this.createDefaultProfile(driverId);
      this.driverProfiles.set(driverId, profile);
    }

    return profile;
  }

  async updateDriverSafetyProfile(
    driverId: string,
    updates: Partial<DriverSafetyProfile>,
  ): Promise<DriverSafetyProfile> {
    const profile = await this.getDriverSafetyProfile(driverId);

    Object.assign(profile, updates);
    this.driverProfiles.set(driverId, profile);

    return profile;
  }

  async recalculateSafetyScore(driverId: string): Promise<number> {
    const profile = await this.getDriverSafetyProfile(driverId);
    const incidents = this.driverIncidents.get(driverId) || [];

    let score = 100;

    // Deduct for incidents
    for (const incident of incidents) {
      const daysAgo =
        (Date.now() - incident.reportedAt.getTime()) / (24 * 60 * 60 * 1000);
      if (daysAgo > 365) continue; // Only consider last year

      const recency = Math.max(0, 1 - daysAgo / 365);

      switch (incident.severity) {
        case "CRITICAL":
          score -= 20 * recency;
          break;
        case "HIGH":
          score -= 10 * recency;
          break;
        case "MEDIUM":
          score -= 5 * recency;
          break;
        case "LOW":
          score -= 2 * recency;
          break;
      }
    }

    // Deduct for speeding
    score -= profile.speedingIncidents * 2;

    // Deduct for hard braking
    score -= Math.min(profile.hardBrakingCount * 0.5, 10);

    // Bonus for rating
    if (profile.averageRating && profile.averageRating >= 4.5) {
      score += 5;
    }

    // Bonus for verified status
    if (profile.isVerified && profile.backgroundClear) {
      score += 5;
    }

    // Normalize
    score = Math.max(0, Math.min(100, score));
    profile.safetyScore = score;

    this.driverProfiles.set(driverId, profile);

    return score;
  }

  private createDefaultProfile(driverId: string): DriverSafetyProfile {
    return {
      driverId,
      safetyScore: 100,
      totalTrips: 0,
      incidentsReported: 0,
      incidentsConfirmed: 0,
      complaintsReceived: 0,
      speedingIncidents: 0,
      hardBrakingCount: 0,
      acceptsCash: true,
      cashlessOnly: false,
      backgroundClear: false,
      isVerified: false,
    };
  }

  // ---------------------------------------------------------------------------
  // RISK ZONE MANAGEMENT
  // ---------------------------------------------------------------------------

  async getRiskZone(location: Location): Promise<RiskZone | null> {
    for (const zone of this.riskZones.values()) {
      if (this.isLocationInZone(location, zone)) {
        return zone;
      }
    }
    return null;
  }

  async getRiskZonesInArea(
    center: Location,
    radius: number,
  ): Promise<RiskZone[]> {
    const zonesInArea: RiskZone[] = [];

    for (const zone of this.riskZones.values()) {
      const distance = this.calculateDistance(center, zone.center);
      if (distance <= radius + (zone.radius || 0)) {
        zonesInArea.push(zone);
      }
    }

    return zonesInArea.sort((a, b) => {
      const riskOrder: Record<RiskLevel, number> = {
        VERY_LOW: 1,
        LOW: 2,
        MEDIUM: 3,
        HIGH: 4,
        VERY_HIGH: 5,
        CRITICAL: 6,
      };
      return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
    });
  }

  async createRiskZone(zone: Omit<RiskZone, "id">): Promise<RiskZone> {
    const newZone: RiskZone = {
      id: this.generateId(),
      ...zone,
    };

    this.riskZones.set(newZone.id, newZone);

    driverLogger.info(
      { zoneName: newZone.name },
      "[DriverSafety] Risk zone created",
    );

    return newZone;
  }

  async updateRiskZone(
    zoneId: string,
    updates: Partial<RiskZone>,
  ): Promise<RiskZone | null> {
    const zone = this.riskZones.get(zoneId);
    if (!zone) return null;

    Object.assign(zone, updates);
    this.riskZones.set(zoneId, zone);

    return zone;
  }

  async checkRouteRiskZones(route: Location[]): Promise<RiskZoneCheck[]> {
    const checks: RiskZoneCheck[] = [];
    const seenZones = new Set<string>();

    for (const point of route) {
      const zone = await this.getRiskZone(point);
      if (zone && !seenZones.has(zone.id)) {
        seenZones.add(zone.id);
        checks.push({
          zone,
          location: point,
          advisory: zone.advisoryText,
        });
      }
    }

    return checks;
  }

  private isLocationInZone(location: Location, zone: RiskZone): boolean {
    const distance = this.calculateDistance(location, zone.center);
    return distance <= (zone.radius || 1000); // Default 1km radius
  }

  private initializeRiskZones(): void {
    // Initialize with known high-risk areas
    // In production, load from database

    // Example zones for Lagos, Nigeria
    const lagosZones: Omit<RiskZone, "id">[] = [
      {
        name: "Oshodi Market Area",
        center: { lat: 6.5567, lng: 3.3514 },
        radius: 1500,
        riskLevel: "HIGH",
        riskFactors: ["high_crime", "traffic_congestion", "pick_pocket"],
        incidentCount: 45,
        advisoryText:
          "Exercise caution. High traffic area with reported incidents.",
        restrictions: {
          cashRestricted: true,
          nightRestricted: true,
          requiresVerifiedDriver: true,
          requiresVerifiedRider: false,
        },
      },
      {
        name: "Mile 2 Area",
        center: { lat: 6.4572, lng: 3.3196 },
        radius: 2000,
        riskLevel: "HIGH",
        riskFactors: ["robbery", "night_danger"],
        incidentCount: 38,
        advisoryText: "Night trips not recommended. Verified drivers only.",
        restrictions: {
          cashRestricted: true,
          nightRestricted: true,
          requiresVerifiedDriver: true,
          requiresVerifiedRider: true,
        },
      },
    ];

    for (const zone of lagosZones) {
      this.createRiskZone(zone);
    }

    driverLogger.info(
      { zoneCount: this.riskZones.size },
      "[DriverSafety] Initialized risk zones",
    );
  }

  // ---------------------------------------------------------------------------
  // CASH TRIP SAFETY
  // ---------------------------------------------------------------------------

  async assessCashTripRisk(
    driverId: string,
    pickup: Location,
    dropoff: Location,
  ): Promise<CashTripAssessment> {
    const profile = await this.getDriverSafetyProfile(driverId);

    // Check if driver accepts cash
    if (profile.cashlessOnly) {
      return {
        allowed: false,
        reason: "Driver only accepts cashless payments",
        recommendation: "Use card or wallet payment",
      };
    }

    // Check pickup and dropoff zones
    const pickupZone = await this.getRiskZone(pickup);
    const dropoffZone = await this.getRiskZone(dropoff);

    if (
      pickupZone?.restrictions?.cashRestricted ||
      dropoffZone?.restrictions?.cashRestricted
    ) {
      return {
        allowed: false,
        reason: "Cash payments restricted in this area",
        zone: pickupZone || dropoffZone || undefined,
        recommendation: "Use cashless payment for safety",
      };
    }

    // Check time-based restrictions
    const hour = new Date().getHours();
    const isNightTime = hour >= 22 || hour < 6;

    if (isNightTime) {
      return {
        allowed: false,
        reason: "Cash payments not available during night hours",
        recommendation: "Use cashless payment for night trips",
      };
    }

    // Check route risk
    const routeRisk = await this.calculateRouteRisk(pickup, dropoff);

    if (routeRisk.score >= 0.7) {
      return {
        allowed: false,
        reason: "High-risk route detected",
        recommendation: "Use cashless payment for this route",
        riskScore: routeRisk.score,
      };
    }

    return {
      allowed: true,
      riskScore: routeRisk.score,
      advisory:
        routeRisk.score > 0.4 ? "Be vigilant during this trip" : undefined,
    };
  }

  async enableCashlessOnly(driverId: string): Promise<void> {
    const profile = await this.getDriverSafetyProfile(driverId);
    profile.cashlessOnly = true;
    profile.acceptsCash = false;
    this.driverProfiles.set(driverId, profile);

    driverLogger.info(
      { driverId },
      "[DriverSafety] Driver enabled cashless-only mode",
    );
  }

  async disableCashlessOnly(driverId: string): Promise<void> {
    const profile = await this.getDriverSafetyProfile(driverId);
    profile.cashlessOnly = false;
    profile.acceptsCash = true;
    this.driverProfiles.set(driverId, profile);
  }

  // ---------------------------------------------------------------------------
  // DRIVER INCIDENT MANAGEMENT
  // ---------------------------------------------------------------------------

  async reportIncident(
    driverId: string,
    report: DriverIncidentReport,
  ): Promise<DriverIncident> {
    const incident: DriverIncident = {
      id: this.generateId(),
      driverId,
      incidentType: report.incidentType,
      severity: report.severity,
      tripId: report.tripId,
      description: report.description,
      location: report.location,
      status: "REPORTED",
      reportedAt: new Date(),
    };

    const incidents = this.driverIncidents.get(driverId) || [];
    incidents.push(incident);
    this.driverIncidents.set(driverId, incidents);

    // Update profile
    const profile = await this.getDriverSafetyProfile(driverId);
    profile.incidentsReported++;
    this.driverProfiles.set(driverId, profile);

    // Emit event for high-severity incidents
    if (incident.severity === "CRITICAL" || incident.severity === "HIGH") {
      this.emit("high_severity_incident", incident);
    }

    // Recalculate safety score
    await this.recalculateSafetyScore(driverId);

    driverLogger.info(
      { incidentId: incident.id, incidentType: incident.incidentType },
      "[DriverSafety] Incident reported",
    );

    return incident;
  }

  async updateIncidentStatus(
    incidentId: string,
    status: IncidentStatus,
    resolution?: string,
  ): Promise<DriverIncident | null> {
    for (const [driverId, incidents] of this.driverIncidents) {
      const incident = incidents.find((i) => i.id === incidentId);
      if (incident) {
        incident.status = status;
        if (resolution) {
          incident.resolution = resolution;
        }

        // Update confirmed count if confirmed
        if (status === "RESOLVED") {
          const profile = await this.getDriverSafetyProfile(driverId);
          profile.incidentsConfirmed++;
          this.driverProfiles.set(driverId, profile);
          await this.recalculateSafetyScore(driverId);
        }

        return incident;
      }
    }

    return null;
  }

  async getDriverIncidents(driverId: string): Promise<DriverIncident[]> {
    return this.driverIncidents.get(driverId) || [];
  }

  // ---------------------------------------------------------------------------
  // DRIVING BEHAVIOR MONITORING
  // ---------------------------------------------------------------------------

  async recordSpeedingIncident(
    driverId: string,
    speed: number,
    limit: number,
    location: Location,
  ): Promise<void> {
    const profile = await this.getDriverSafetyProfile(driverId);
    profile.speedingIncidents++;
    this.driverProfiles.set(driverId, profile);

    // Create incident if severe
    if (speed > this.SPEEDING_THRESHOLD_KMH) {
      await this.reportIncident(driverId, {
        incidentType: "VEHICLE_ISSUE",
        severity: speed > 150 ? "HIGH" : "MEDIUM",
        description: `Excessive speeding: ${Math.round(speed)} km/h (limit: ${limit} km/h)`,
        location,
      });
    }

    await this.recalculateSafetyScore(driverId);
  }

  async recordHardBraking(
    driverId: string,
    gForce: number,
    _location: Location,
  ): Promise<void> {
    const profile = await this.getDriverSafetyProfile(driverId);
    profile.hardBrakingCount++;
    this.driverProfiles.set(driverId, profile);

    if (gForce > this.HARD_BRAKE_THRESHOLD_G * 2) {
      driverLogger.info(
        { driverId, gForce },
        "[DriverSafety] Severe hard braking detected",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // FATIGUE MONITORING
  // ---------------------------------------------------------------------------

  async startDrivingSession(driverId: string): Promise<DrivingSession> {
    const session: DrivingSession = {
      id: this.generateId(),
      driverId,
      startTime: new Date(),
      isActive: true,
      tripCount: 0,
      totalDistanceKm: 0,
      breaks: [],
    };

    const sessions = this.drivingHistory.get(driverId) || [];
    sessions.push(session);
    this.drivingHistory.set(driverId, sessions);

    // Schedule fatigue check
    this.scheduleFatigueCheck(driverId, session.id);

    return session;
  }

  async endDrivingSession(
    driverId: string,
    sessionId: string,
  ): Promise<DrivingSession | null> {
    const sessions = this.drivingHistory.get(driverId) || [];
    const session = sessions.find((s) => s.id === sessionId);

    if (session) {
      session.isActive = false;
      session.endTime = new Date();
    }

    return session || null;
  }

  async recordBreak(driverId: string, durationMinutes: number): Promise<void> {
    const sessions = this.drivingHistory.get(driverId) || [];
    const activeSession = sessions.find((s) => s.isActive);

    if (activeSession) {
      activeSession.breaks.push({
        startTime: new Date(Date.now() - durationMinutes * 60 * 1000),
        endTime: new Date(),
        durationMinutes,
      });
    }
  }

  async checkFatigue(driverId: string): Promise<FatigueAssessment> {
    const sessions = this.drivingHistory.get(driverId) || [];
    const now = new Date();

    // Check continuous driving
    const activeSession = sessions.find((s) => s.isActive);
    let continuousDrivingHours = 0;

    if (activeSession) {
      const lastBreak = activeSession.breaks[activeSession.breaks.length - 1];
      const lastBreakEnd = lastBreak
        ? lastBreak.endTime
        : activeSession.startTime;
      continuousDrivingHours =
        (now.getTime() - lastBreakEnd.getTime()) / (60 * 60 * 1000);
    }

    // Check weekly hours
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weeklyHours = sessions
      .filter((s) => s.startTime >= weekAgo)
      .reduce((total, s) => {
        const end = s.endTime || now;
        return (
          total + (end.getTime() - s.startTime.getTime()) / (60 * 60 * 1000)
        );
      }, 0);

    // Assess fatigue
    const needsBreak =
      continuousDrivingHours >= this.MAX_CONTINUOUS_DRIVING_HOURS;
    const atWeeklyLimit = weeklyHours >= this.MAX_WEEKLY_HOURS;

    let fatigueLevel: "low" | "medium" | "high" | "critical" = "low";
    if (continuousDrivingHours >= this.MAX_CONTINUOUS_DRIVING_HOURS * 0.8)
      fatigueLevel = "medium";
    if (continuousDrivingHours >= this.MAX_CONTINUOUS_DRIVING_HOURS)
      fatigueLevel = "high";
    if (needsBreak && atWeeklyLimit) fatigueLevel = "critical";

    const assessment: FatigueAssessment = {
      driverId,
      continuousDrivingHours,
      weeklyDrivingHours: weeklyHours,
      fatigueLevel,
      needsBreak,
      atWeeklyLimit,
      recommendation: this.getFatigueRecommendation(fatigueLevel),
    };

    // Create alert if needed
    if (fatigueLevel !== "low") {
      await this.createFatigueAlert(driverId, assessment);
    }

    return assessment;
  }

  private async createFatigueAlert(
    driverId: string,
    assessment: FatigueAssessment,
  ): Promise<void> {
    const alerts = this.fatigueAlerts.get(driverId) || [];

    const alert: FatigueAlert = {
      id: this.generateId(),
      driverId,
      level: assessment.fatigueLevel,
      continuousHours: assessment.continuousDrivingHours,
      weeklyHours: assessment.weeklyDrivingHours,
      recommendation: assessment.recommendation,
      createdAt: new Date(),
      acknowledged: false,
    };

    alerts.push(alert);
    this.fatigueAlerts.set(driverId, alerts);

    // Emit event for high fatigue
    if (
      assessment.fatigueLevel === "high" ||
      assessment.fatigueLevel === "critical"
    ) {
      this.emit("fatigue_warning", { driverId, assessment, alert });
    }

    driverLogger.info(
      { driverId, fatigueLevel: assessment.fatigueLevel },
      "[DriverSafety] Fatigue alert created",
    );
  }

  private getFatigueRecommendation(
    level: "low" | "medium" | "high" | "critical",
  ): string {
    switch (level) {
      case "critical":
        return "Immediately stop driving. Take at least 8 hours rest before continuing.";
      case "high":
        return "Take a 30-minute break soon. Consider ending your shift.";
      case "medium":
        return "Consider taking a short break in the next hour.";
      default:
        return "You're doing well. Stay hydrated and alert.";
    }
  }

  private scheduleFatigueCheck(driverId: string, sessionId: string): void {
    // Check every 2 hours
    const checkInterval = 2 * 60 * 60 * 1000;

    const checkTimer = setInterval(async () => {
      const sessions = this.drivingHistory.get(driverId) || [];
      const session = sessions.find((s) => s.id === sessionId);

      if (!session || !session.isActive) {
        clearInterval(checkTimer);
        return;
      }

      await this.checkFatigue(driverId);
    }, checkInterval);
  }

  // ---------------------------------------------------------------------------
  // SAFETY RECOMMENDATIONS
  // ---------------------------------------------------------------------------

  async getDriverSafetyRecommendations(
    driverId: string,
  ): Promise<SafetyRecommendation[]> {
    const recommendations: SafetyRecommendation[] = [];
    const profile = await this.getDriverSafetyProfile(driverId);
    const incidents = await this.getDriverIncidents(driverId);

    // Background check recommendation
    if (!profile.backgroundClear) {
      recommendations.push({
        type: "verification",
        priority: "high",
        title: "Complete Background Check",
        description:
          "A clear background check increases your safety score and rider trust.",
        action: "Complete background verification",
      });
    }

    // Cashless recommendation if in high-risk areas
    if (profile.acceptsCash && !profile.cashlessOnly) {
      const hasHighRiskTrips = incidents.some(
        (i) =>
          i.incidentType === "ROBBERY" ||
          i.description?.toLowerCase().includes("cash"),
      );

      if (hasHighRiskTrips) {
        recommendations.push({
          type: "payment",
          priority: "high",
          title: "Enable Cashless-Only Mode",
          description:
            "You've had cash-related incidents. Consider going cashless for safety.",
          action: "Enable cashless mode",
        });
      }
    }

    // Speeding recommendation
    if (profile.speedingIncidents > 5) {
      recommendations.push({
        type: "driving",
        priority: "medium",
        title: "Reduce Speeding",
        description:
          "You have multiple speeding incidents. Safe driving improves your score.",
        action: "Drive within speed limits",
      });
    }

    // Hard braking recommendation
    if (profile.hardBrakingCount > 20) {
      recommendations.push({
        type: "driving",
        priority: "low",
        title: "Improve Braking Habits",
        description: "Frequent hard braking affects rider comfort and safety.",
        action: "Anticipate stops earlier",
      });
    }

    // Fatigue recommendation
    const fatigueAssessment = await this.checkFatigue(driverId);
    if (fatigueAssessment.fatigueLevel !== "low") {
      recommendations.push({
        type: "health",
        priority:
          fatigueAssessment.fatigueLevel === "critical" ? "critical" : "high",
        title: "Take a Break",
        description: fatigueAssessment.recommendation,
        action: "Take rest break",
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
      };
      return (
        (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0)
      );
    });
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  private async calculateRouteRisk(
    pickup: Location,
    dropoff: Location,
  ): Promise<{ score: number }> {
    // Check for risk zones along route
    // In production, use routing API to get actual route
    const pickupZone = await this.getRiskZone(pickup);
    const dropoffZone = await this.getRiskZone(dropoff);

    let score = 0;

    if (pickupZone) {
      score += this.riskLevelToScore(pickupZone.riskLevel) * 0.5;
    }

    if (dropoffZone) {
      score += this.riskLevelToScore(dropoffZone.riskLevel) * 0.5;
    }

    return { score: Math.min(score, 1) };
  }

  private riskLevelToScore(level: RiskLevel): number {
    const scores: Record<RiskLevel, number> = {
      VERY_LOW: 0.1,
      LOW: 0.2,
      MEDIUM: 0.4,
      HIGH: 0.7,
      VERY_HIGH: 0.85,
      CRITICAL: 1.0,
    };
    return scores[level];
  }

  private calculateDistance(loc1: Location, loc2: Location): number {
    const R = 6371000;
    const lat1 = (loc1.lat * Math.PI) / 180;
    const lat2 = (loc2.lat * Math.PI) / 180;
    const deltaLat = ((loc2.lat - loc1.lat) * Math.PI) / 180;
    const deltaLng = ((loc2.lng - loc1.lng) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private generateId(): string {
    return `ds_${crypto.randomBytes(12).toString("hex")}`;
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface DriverIncidentReport {
  incidentType: IncidentType;
  severity: IncidentSeverity;
  tripId?: string;
  description: string;
  location?: Location;
}

interface DrivingSession {
  id: string;
  driverId: string;
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
  tripCount: number;
  totalDistanceKm: number;
  breaks: {
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
  }[];
}

interface FatigueAlert {
  id: string;
  driverId: string;
  level: "low" | "medium" | "high" | "critical";
  continuousHours: number;
  weeklyHours: number;
  recommendation: string;
  createdAt: Date;
  acknowledged: boolean;
}

interface FatigueAssessment {
  driverId: string;
  continuousDrivingHours: number;
  weeklyDrivingHours: number;
  fatigueLevel: "low" | "medium" | "high" | "critical";
  needsBreak: boolean;
  atWeeklyLimit: boolean;
  recommendation: string;
}

interface CashTripAssessment {
  allowed: boolean;
  reason?: string;
  zone?: RiskZone;
  recommendation?: string;
  riskScore?: number;
  advisory?: string;
}

interface RiskZoneCheck {
  zone: RiskZone;
  location: Location;
  advisory?: string;
}

interface SafetyRecommendation {
  type: "verification" | "payment" | "driving" | "health";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  action: string;
}

// DriverIncident is imported from ../types/safety.types

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const driverSafetyService = new DriverSafetyService();
