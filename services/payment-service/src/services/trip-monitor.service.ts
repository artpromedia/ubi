/**
 * UBI Trip Monitor Service
 *
 * Real-time trip safety monitoring:
 * - Route deviation detection
 * - Unexpected stop detection
 * - Speed anomaly detection
 * - Crash detection (accelerometer + GPS)
 * - Safety check-ins
 * - Automatic escalation
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import {
  AccelData,
  AnomalyDetails,
  CrashDetection,
  IncidentSeverity,
  Location,
  SafetyEvent,
  TripAnomaly,
  TripAnomalyType,
  TripSafetyCheck,
  TripSafetySession,
  TripShare,
} from "../types/safety.types";

// =============================================================================
// TRIP MONITOR SERVICE
// =============================================================================

export class TripMonitorService extends EventEmitter {
  private activeSessions: Map<string, TripSafetySession> = new Map();
  private locationHistory: Map<string, Location[]> = new Map();
  private anomalyStore: Map<string, TripAnomaly[]> = new Map();
  private safetyChecks: Map<string, TripSafetyCheck> = new Map();
  private crashBuffer: Map<string, AccelData[]> = new Map();

  // Thresholds
  private readonly ROUTE_DEVIATION_THRESHOLD_METERS = 500;
  private readonly UNEXPECTED_STOP_THRESHOLD_SECONDS = 180; // 3 minutes
  private readonly SPEED_ANOMALY_THRESHOLD_KMH = 120;
  private readonly CRASH_G_FORCE_THRESHOLD = 4.0;
  private readonly CRASH_SPEED_DROP_THRESHOLD = 30; // km/h
  private readonly SAFETY_CHECK_TIMEOUT_SECONDS = 60;
  private readonly LOCATION_JUMP_THRESHOLD_METERS = 1000;

  constructor() {
    super();
    this.startBackgroundProcessing();
  }

  // ---------------------------------------------------------------------------
  // SESSION MANAGEMENT
  // ---------------------------------------------------------------------------

  async startMonitoring(
    params: StartMonitoringParams
  ): Promise<TripSafetySession> {
    const {
      tripId,
      riderId,
      driverId,
      expectedRoute,
      expectedDuration,
      womenSafetyMode = false,
      emergencyContacts = [],
    } = params;

    // Calculate initial risk score
    const riskScore = await this.calculateInitialRiskScore(
      riderId,
      driverId,
      expectedRoute
    );

    const session: TripSafetySession = {
      id: this.generateId(),
      tripId,
      riderId,
      driverId,
      status: "monitoring",
      expectedRoute,
      expectedDuration,
      riskScore,
      anomalyCount: 0,
      womenSafetyMode,
      sharedWithContacts: emergencyContacts.length > 0,
      monitoringStartedAt: new Date(),
    };

    this.activeSessions.set(tripId, session);
    this.locationHistory.set(tripId, []);
    this.anomalyStore.set(tripId, []);
    this.crashBuffer.set(tripId, []);

    // Auto-share if women safety mode
    if (womenSafetyMode && emergencyContacts.length > 0) {
      await this.createTripShare(tripId, riderId, emergencyContacts);
    }

    this.emitSafetyEvent("trip_started", riderId, {
      tripId,
      driverId,
      riskScore,
    });

    console.log(
      "[TripMonitor] Started monitoring trip:",
      tripId,
      "Risk score:",
      riskScore
    );

    return session;
  }

  async stopMonitoring(
    tripId: string,
    reason: "completed" | "cancelled" | "incident"
  ): Promise<void> {
    const session = this.activeSessions.get(tripId);
    if (!session) return;

    session.status = reason === "incident" ? "incident" : "completed";

    // Archive session data
    await this.archiveSession(session);

    // Cleanup
    this.activeSessions.delete(tripId);
    this.locationHistory.delete(tripId);
    this.crashBuffer.delete(tripId);

    const eventType =
      reason === "completed" ? "trip_completed" : "trip_cancelled";
    this.emitSafetyEvent(eventType, session.riderId, { tripId, reason });

    console.log(
      "[TripMonitor] Stopped monitoring trip:",
      tripId,
      "Reason:",
      reason
    );
  }

  async getActiveSession(tripId: string): Promise<TripSafetySession | null> {
    return this.activeSessions.get(tripId) || null;
  }

  // ---------------------------------------------------------------------------
  // LOCATION PROCESSING
  // ---------------------------------------------------------------------------

  async processLocationUpdate(
    tripId: string,
    location: Location
  ): Promise<LocationProcessResult> {
    const session = this.activeSessions.get(tripId);
    if (!session) {
      return { processed: false, error: "No active session" };
    }

    const history = this.locationHistory.get(tripId) || [];
    const previousLocation = history[history.length - 1];

    // Store location
    history.push(location);
    this.locationHistory.set(tripId, history);

    const anomalies: TripAnomaly[] = [];

    // Check for location jump (impossible travel)
    if (previousLocation) {
      const jumpAnomaly = this.detectLocationJump(
        tripId,
        previousLocation,
        location
      );
      if (jumpAnomaly) anomalies.push(jumpAnomaly);
    }

    // Check route deviation
    const deviationAnomaly = this.detectRouteDeviation(
      tripId,
      session,
      location
    );
    if (deviationAnomaly) anomalies.push(deviationAnomaly);

    // Check unexpected stop
    const stopAnomaly = await this.detectUnexpectedStop(tripId, history);
    if (stopAnomaly) anomalies.push(stopAnomaly);

    // Check speed anomaly
    if (location.speed !== undefined) {
      const speedAnomaly = this.detectSpeedAnomaly(tripId, location);
      if (speedAnomaly) anomalies.push(speedAnomaly);
    }

    // Process anomalies
    for (const anomaly of anomalies) {
      await this.handleAnomaly(session, anomaly);
    }

    // Update session risk score
    session.riskScore = this.recalculateRiskScore(session, anomalies);
    session.anomalyCount += anomalies.length;

    // Emit location update event
    this.emitSafetyEvent("location_update", session.riderId, {
      tripId,
      location,
      riskScore: session.riskScore,
      anomalies: anomalies.map((a) => a.anomalyType),
    });

    return {
      processed: true,
      anomalies,
      riskScore: session.riskScore,
    };
  }

  // ---------------------------------------------------------------------------
  // ANOMALY DETECTION
  // ---------------------------------------------------------------------------

  private detectRouteDeviation(
    tripId: string,
    session: TripSafetySession,
    currentLocation: Location
  ): TripAnomaly | null {
    if (!session.expectedRoute || session.expectedRoute.length < 2) return null;

    const distanceFromRoute = this.calculateDistanceFromRoute(
      currentLocation,
      session.expectedRoute
    );

    if (distanceFromRoute > this.ROUTE_DEVIATION_THRESHOLD_METERS) {
      const severity = this.calculateDeviationSeverity(distanceFromRoute);

      return this.createAnomaly(
        tripId,
        "ROUTE_DEVIATION",
        severity,
        {
          distanceFromRoute,
          description: `${Math.round(distanceFromRoute)}m off expected route`,
        },
        currentLocation
      );
    }

    return null;
  }

  private async detectUnexpectedStop(
    tripId: string,
    history: Location[]
  ): Promise<TripAnomaly | null> {
    if (history.length < 10) return null;

    const recentLocations = history.slice(-10);
    const firstLoc = recentLocations[0];
    const lastLoc = recentLocations[recentLocations.length - 1];

    // Check if vehicle has been stationary
    const distance = this.calculateDistance(firstLoc, lastLoc);
    const timeDiff =
      (lastLoc.timestamp?.getTime() || Date.now()) -
      (firstLoc.timestamp?.getTime() || Date.now());
    const timeDiffSeconds = timeDiff / 1000;

    if (
      distance < 50 &&
      timeDiffSeconds > this.UNEXPECTED_STOP_THRESHOLD_SECONDS
    ) {
      const session = this.activeSessions.get(tripId);
      if (!session) return null;

      // Check if this is near expected stops (dropoff, pickup)
      const isExpectedStop = this.isNearExpectedStop(
        lastLoc,
        session.expectedRoute
      );
      if (isExpectedStop) return null;

      return this.createAnomaly(
        tripId,
        "UNEXPECTED_STOP",
        "MEDIUM",
        {
          stopDuration: timeDiffSeconds,
          description: `Vehicle stopped for ${Math.round(timeDiffSeconds / 60)} minutes`,
        },
        lastLoc
      );
    }

    return null;
  }

  private detectSpeedAnomaly(
    tripId: string,
    location: Location
  ): TripAnomaly | null {
    if (!location.speed) return null;

    const speedKmh = location.speed * 3.6; // Convert m/s to km/h

    if (speedKmh > this.SPEED_ANOMALY_THRESHOLD_KMH) {
      return this.createAnomaly(
        tripId,
        "EXCESSIVE_SPEED",
        "HIGH",
        {
          currentSpeed: speedKmh,
          expectedSpeed: this.SPEED_ANOMALY_THRESHOLD_KMH,
          description: `Excessive speed: ${Math.round(speedKmh)} km/h`,
        },
        location
      );
    }

    return null;
  }

  private detectLocationJump(
    tripId: string,
    previousLocation: Location,
    currentLocation: Location
  ): TripAnomaly | null {
    const distance = this.calculateDistance(previousLocation, currentLocation);
    const timeDiff =
      (currentLocation.timestamp?.getTime() || Date.now()) -
      (previousLocation.timestamp?.getTime() || Date.now());
    const timeDiffSeconds = timeDiff / 1000;

    // Calculate theoretical max distance (assuming 200 km/h max)
    const maxPossibleDistance = (200 / 3.6) * timeDiffSeconds; // meters

    if (
      distance >
      Math.max(this.LOCATION_JUMP_THRESHOLD_METERS, maxPossibleDistance * 1.5)
    ) {
      return this.createAnomaly(
        tripId,
        "LOCATION_JUMP",
        "HIGH",
        {
          description: `Location jumped ${Math.round(distance)}m in ${Math.round(timeDiffSeconds)}s`,
          confidence: 0.9,
        },
        currentLocation
      );
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // CRASH DETECTION
  // ---------------------------------------------------------------------------

  async processAccelerometerData(
    tripId: string,
    data: AccelData
  ): Promise<CrashDetection | null> {
    const session = this.activeSessions.get(tripId);
    if (!session) return null;

    const buffer = this.crashBuffer.get(tripId) || [];
    buffer.push(data);

    // Keep last 50 readings
    if (buffer.length > 50) buffer.shift();
    this.crashBuffer.set(tripId, buffer);

    // Calculate G-force
    const gForce = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2) / 9.81;

    // Detect sudden deceleration
    if (gForce >= this.CRASH_G_FORCE_THRESHOLD) {
      const recentSpeeds = buffer.slice(-10).map((d) => d.currentSpeed);
      const avgRecentSpeed =
        recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
      const currentSpeed = data.currentSpeed;
      const speedDrop = avgRecentSpeed - currentSpeed;

      if (speedDrop >= this.CRASH_SPEED_DROP_THRESHOLD / 3.6) {
        // Convert to m/s
        const crash: CrashDetection = {
          type: "potential_crash",
          severity: "critical",
          impactForce: gForce,
          speedDrop: speedDrop * 3.6, // Convert to km/h
          location: data.location,
          timestamp: data.timestamp,
          accelerometerData: data,
        };

        // Create critical anomaly
        const anomaly = this.createAnomaly(
          tripId,
          "CRASH_DETECTED",
          "CRITICAL",
          {
            impactForce: gForce,
            speedDrop: crash.speedDrop,
            description: "Potential crash detected",
          },
          data.location
        );

        await this.handleAnomaly(session, anomaly);

        // Immediately trigger safety check
        await this.triggerSafetyCheck(
          tripId,
          session.riderId,
          "Potential crash detected"
        );
        await this.triggerSafetyCheck(
          tripId,
          session.driverId,
          "Potential crash detected"
        );

        this.emitSafetyEvent("crash_detected", session.riderId, {
          tripId,
          crash,
          driverId: session.driverId,
        });

        console.log(
          "[TripMonitor] CRASH DETECTED for trip:",
          tripId,
          "G-force:",
          gForce
        );

        return crash;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // SAFETY CHECKS
  // ---------------------------------------------------------------------------

  async triggerSafetyCheck(
    tripId: string,
    userId: string,
    reason: string
  ): Promise<TripSafetyCheck> {
    const checkId = this.generateId();

    const check: TripSafetyCheck = {
      id: checkId,
      tripId,
      userId,
      reason,
      status: "SENT",
      sentAt: new Date(),
      timeoutSeconds: this.SAFETY_CHECK_TIMEOUT_SECONDS,
    };

    this.safetyChecks.set(checkId, check);

    // Send push notification to user
    await this.sendSafetyCheckNotification(userId, checkId, reason);

    // Schedule timeout
    setTimeout(
      () => this.handleSafetyCheckTimeout(checkId),
      this.SAFETY_CHECK_TIMEOUT_SECONDS * 1000
    );

    this.emitSafetyEvent("safety_check_sent", userId, {
      tripId,
      checkId,
      reason,
    });

    console.log("[TripMonitor] Safety check sent:", checkId, "User:", userId);

    return check;
  }

  async respondToSafetyCheck(
    checkId: string,
    response: "safe" | "need_help"
  ): Promise<{ success: boolean; escalated?: boolean }> {
    const check = this.safetyChecks.get(checkId);
    if (!check) {
      return { success: false };
    }

    check.respondedAt = new Date();
    check.responseType = response;

    if (response === "safe") {
      check.status = "CONFIRMED_SAFE";
      this.emitSafetyEvent("safety_check_responded", check.userId, {
        checkId,
        response: "safe",
      });
      return { success: true, escalated: false };
    } else {
      check.status = "HELP_REQUESTED";

      // Escalate immediately
      await this.escalateToSafetyTeam(
        check.tripId,
        check.userId,
        "User requested help via safety check"
      );

      this.emitSafetyEvent("safety_check_responded", check.userId, {
        checkId,
        response: "need_help",
      });

      return { success: true, escalated: true };
    }
  }

  private async handleSafetyCheckTimeout(checkId: string): Promise<void> {
    const check = this.safetyChecks.get(checkId);
    if (!check || check.status !== "SENT") return;

    check.status = "NO_RESPONSE";
    check.responseType = "no_response";

    console.log("[TripMonitor] Safety check timeout:", checkId);

    // Escalate due to no response
    await this.escalateToSafetyTeam(
      check.tripId,
      check.userId,
      "No response to safety check"
    );

    this.emitSafetyEvent("safety_check_timeout", check.userId, {
      checkId,
      tripId: check.tripId,
    });
  }

  // ---------------------------------------------------------------------------
  // TRIP SHARING
  // ---------------------------------------------------------------------------

  async createTripShare(
    tripId: string,
    userId: string,
    contactIds: string[]
  ): Promise<TripShare[]> {
    const shares: TripShare[] = [];

    const shareLink = await this.generateShareLink(tripId);

    for (const contactId of contactIds) {
      const share: TripShare = {
        id: this.generateId(),
        tripId,
        sharedBy: userId,
        shareType: "contact",
        shareLink,
        contactId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        isActive: true,
      };

      shares.push(share);

      // Notify contact
      await this.notifyTripShareContact(contactId, share);
    }

    // Update session
    const session = this.activeSessions.get(tripId);
    if (session) {
      session.sharedWithContacts = true;
    }

    console.log(
      "[TripMonitor] Trip shared with",
      contactIds.length,
      "contacts"
    );

    return shares;
  }

  async generatePublicShareLink(tripId: string): Promise<string> {
    return this.generateShareLink(tripId);
  }

  private async generateShareLink(tripId: string): Promise<string> {
    const token = crypto.randomBytes(16).toString("hex");
    // Store token mapping in production
    return `https://ubi.app/trip/track/${token}`;
  }

  private async notifyTripShareContact(
    contactId: string,
    share: TripShare
  ): Promise<void> {
    // In production, send SMS/WhatsApp/Email with share link
    console.log(
      "[TripMonitor] Notified contact:",
      contactId,
      "with share link"
    );
  }

  // ---------------------------------------------------------------------------
  // ESCALATION
  // ---------------------------------------------------------------------------

  private async handleAnomaly(
    session: TripSafetySession,
    anomaly: TripAnomaly
  ): Promise<void> {
    const anomalies = this.anomalyStore.get(session.tripId) || [];
    anomalies.push(anomaly);
    this.anomalyStore.set(session.tripId, anomalies);

    this.emitSafetyEvent("anomaly_detected", session.riderId, {
      tripId: session.tripId,
      anomaly,
    });

    // Auto-escalation rules
    if (anomaly.severity === "CRITICAL") {
      await this.escalateToSafetyTeam(
        session.tripId,
        session.riderId,
        `Critical anomaly: ${anomaly.anomalyType}`
      );
    } else if (
      anomaly.severity === "HIGH" &&
      anomalies.filter((a) => a.severity === "HIGH").length >= 3
    ) {
      await this.escalateToSafetyTeam(
        session.tripId,
        session.riderId,
        "Multiple high-severity anomalies detected"
      );
    }
  }

  private async escalateToSafetyTeam(
    tripId: string,
    userId: string,
    reason: string
  ): Promise<void> {
    console.log(
      "[TripMonitor] ESCALATING to safety team:",
      tripId,
      "Reason:",
      reason
    );

    // In production, this would:
    // 1. Create an incident in the safety dashboard
    // 2. Alert on-duty safety agents
    // 3. Potentially contact emergency services

    this.emit("escalation", {
      tripId,
      userId,
      reason,
      timestamp: new Date(),
      priority: "high",
    });
  }

  // ---------------------------------------------------------------------------
  // PHONE INACTIVITY DETECTION
  // ---------------------------------------------------------------------------

  async reportPhoneActivity(
    tripId: string,
    userId: string,
    isActive: boolean
  ): Promise<void> {
    const session = this.activeSessions.get(tripId);
    if (!session) return;

    if (!isActive) {
      // Phone went inactive - could indicate danger
      const anomaly = this.createAnomaly(tripId, "PHONE_INACTIVE", "MEDIUM", {
        description: "User phone became inactive during trip",
      });

      await this.handleAnomaly(session, anomaly);

      // Trigger safety check after 2 minutes of inactivity
      setTimeout(async () => {
        const currentSession = this.activeSessions.get(tripId);
        if (currentSession && currentSession.status === "monitoring") {
          await this.triggerSafetyCheck(
            tripId,
            userId,
            "Phone inactivity detected"
          );
        }
      }, 120000);
    }
  }

  // ---------------------------------------------------------------------------
  // RISK SCORING
  // ---------------------------------------------------------------------------

  private async calculateInitialRiskScore(
    riderId: string,
    driverId: string,
    route: Location[]
  ): Promise<number> {
    let riskScore = 0;

    // Time of day factor
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 6) {
      riskScore += 15; // Night time
    }

    // Route through high-risk areas
    const riskZones = await this.checkRouteRiskZones(route);
    riskScore += riskZones.length * 10;

    // Driver rating factor (in production, fetch actual rating)
    // Lower rating = higher risk

    // Route length factor
    const routeLength = this.calculateRouteLength(route);
    if (routeLength > 30000) {
      // 30km
      riskScore += 10;
    }

    return Math.min(riskScore, 100);
  }

  private recalculateRiskScore(
    session: TripSafetySession,
    newAnomalies: TripAnomaly[]
  ): number {
    let score = session.riskScore;

    for (const anomaly of newAnomalies) {
      switch (anomaly.severity) {
        case "CRITICAL":
          score += 30;
          break;
        case "HIGH":
          score += 20;
          break;
        case "MEDIUM":
          score += 10;
          break;
        case "LOW":
          score += 5;
          break;
      }
    }

    return Math.min(score, 100);
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  private calculateDistanceFromRoute(
    location: Location,
    route: Location[]
  ): number {
    let minDistance = Infinity;

    for (let i = 0; i < route.length - 1; i++) {
      const distance = this.pointToSegmentDistance(
        location,
        route[i],
        route[i + 1]
      );
      minDistance = Math.min(minDistance, distance);
    }

    return minDistance;
  }

  private pointToSegmentDistance(
    point: Location,
    segStart: Location,
    segEnd: Location
  ): number {
    const dx = segEnd.lng - segStart.lng;
    const dy = segEnd.lat - segStart.lat;

    if (dx === 0 && dy === 0) {
      return this.calculateDistance(point, segStart);
    }

    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.lng - segStart.lng) * dx + (point.lat - segStart.lat) * dy) /
          (dx * dx + dy * dy)
      )
    );

    const nearestPoint: Location = {
      lat: segStart.lat + t * dy,
      lng: segStart.lng + t * dx,
    };

    return this.calculateDistance(point, nearestPoint);
  }

  private calculateDistance(loc1: Location, loc2: Location): number {
    const R = 6371000; // Earth radius in meters
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

  private calculateRouteLength(route: Location[]): number {
    let length = 0;
    for (let i = 0; i < route.length - 1; i++) {
      length += this.calculateDistance(route[i], route[i + 1]);
    }
    return length;
  }

  private calculateDeviationSeverity(distanceMeters: number): IncidentSeverity {
    if (distanceMeters > 2000) return "CRITICAL";
    if (distanceMeters > 1000) return "HIGH";
    if (distanceMeters > 500) return "MEDIUM";
    return "LOW";
  }

  private isNearExpectedStop(location: Location, route: Location[]): boolean {
    if (!route || route.length < 2) return false;

    const dropoff = route[route.length - 1];
    const distanceToDropoff = this.calculateDistance(location, dropoff);

    return distanceToDropoff < 200; // Within 200m of dropoff
  }

  private async checkRouteRiskZones(route: Location[]): Promise<string[]> {
    // In production, check against risk zone database
    return [];
  }

  private createAnomaly(
    tripId: string,
    type: TripAnomalyType,
    severity: IncidentSeverity,
    details: AnomalyDetails,
    location?: Location
  ): TripAnomaly {
    return {
      id: this.generateId(),
      tripId,
      anomalyType: type,
      severity,
      details,
      location,
      detectedAt: new Date(),
    };
  }

  private async archiveSession(session: TripSafetySession): Promise<void> {
    // In production, store to database
    console.log("[TripMonitor] Archived session:", session.tripId);
  }

  private async sendSafetyCheckNotification(
    userId: string,
    checkId: string,
    reason: string
  ): Promise<void> {
    // In production, send push notification
    console.log("[TripMonitor] Sent safety check notification to:", userId);
  }

  private generateId(): string {
    return `tm_${crypto.randomBytes(12).toString("hex")}`;
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

  private startBackgroundProcessing(): void {
    // Monitor active sessions periodically
    setInterval(() => {
      this.checkStaleLocations();
    }, 30000); // Every 30 seconds
  }

  private checkStaleLocations(): void {
    const now = Date.now();

    for (const [tripId, session] of this.activeSessions) {
      const history = this.locationHistory.get(tripId) || [];
      const lastLocation = history[history.length - 1];

      if (lastLocation?.timestamp) {
        const staleness = now - lastLocation.timestamp.getTime();

        // If no location update for 5 minutes during active trip
        if (staleness > 300000 && session.status === "monitoring") {
          console.log(
            "[TripMonitor] Stale location detected for trip:",
            tripId
          );

          const anomaly = this.createAnomaly(
            tripId,
            "DRIVER_UNRESPONSIVE",
            "HIGH",
            {
              description: `No location update for ${Math.round(staleness / 60000)} minutes`,
            },
            lastLocation
          );

          this.handleAnomaly(session, anomaly);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API FOR TRIP INFO
  // ---------------------------------------------------------------------------

  async getTripAnomalies(tripId: string): Promise<TripAnomaly[]> {
    return this.anomalyStore.get(tripId) || [];
  }

  async getTripLocationHistory(tripId: string): Promise<Location[]> {
    return this.locationHistory.get(tripId) || [];
  }

  async getActiveTripCount(): Promise<number> {
    return this.activeSessions.size;
  }

  async getHighRiskTrips(): Promise<TripSafetySession[]> {
    const highRisk: TripSafetySession[] = [];

    for (const session of this.activeSessions.values()) {
      if (session.riskScore >= 50) {
        highRisk.push(session);
      }
    }

    return highRisk.sort((a, b) => b.riskScore - a.riskScore);
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface StartMonitoringParams {
  tripId: string;
  riderId: string;
  driverId: string;
  expectedRoute: Location[];
  expectedDuration: number;
  womenSafetyMode?: boolean;
  emergencyContacts?: string[];
}

interface LocationProcessResult {
  processed: boolean;
  error?: string;
  anomalies?: TripAnomaly[];
  riskScore?: number;
}

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const tripMonitorService = new TripMonitorService();
