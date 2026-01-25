/**
 * UBI Women Safety Service
 *
 * Specialized safety features for women riders:
 * - Female driver preference matching
 * - PIN verification before trip start
 * - Auto trip sharing with trusted contacts
 * - Safe word detection
 * - Quiet hours configuration
 * - Verified driver requirements
 * - Enhanced monitoring during night hours
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { womenSafetyLogger } from "../lib/logger";
import {
  EmergencyContact,
  FemaleDriverMatch,
  GenderPreference,
  Location,
  TripPinVerification,
  WomenSafetyPreference,
} from "../types/safety.types";

// =============================================================================
// WOMEN SAFETY SERVICE
// =============================================================================

export class WomenSafetyService extends EventEmitter {
  private readonly userPreferences: Map<string, WomenSafetyPreference> =
    new Map();
  private readonly activePins: Map<string, TripPinVerification> = new Map();
  private readonly safeWords: Map<string, string[]> = new Map();
  private readonly femaleDrivers: Map<string, FemaleDriverProfile> = new Map();
  private readonly tripShareSessions: Map<string, TripShareSession> = new Map();

  constructor() {
    super();
    this.initializeFemaleDriverRegistry();
  }

  // ---------------------------------------------------------------------------
  // PREFERENCES MANAGEMENT
  // ---------------------------------------------------------------------------

  async getPreferences(userId: string): Promise<WomenSafetyPreference> {
    let prefs = this.userPreferences.get(userId);

    if (!prefs) {
      prefs = this.createDefaultPreferences(userId);
      this.userPreferences.set(userId, prefs);
    }

    return prefs;
  }

  async updatePreferences(
    userId: string,
    updates: Partial<WomenSafetyPreference>,
  ): Promise<WomenSafetyPreference> {
    const current = await this.getPreferences(userId);

    const updated: WomenSafetyPreference = {
      ...current,
      ...updates,
      userId, // Ensure userId doesn't change
    };

    this.userPreferences.set(userId, updated);

    womenSafetyLogger.info({ userId }, "[WomenSafety] Preferences updated");

    return updated;
  }

  async enableWomenSafetyMode(userId: string): Promise<WomenSafetyPreference> {
    return this.updatePreferences(userId, {
      womenSafetyModeEnabled: true,
      genderPreference: "FEMALE_ONLY",
      pinVerificationEnabled: true,
      preferVerifiedDrivers: true,
    });
  }

  async disableWomenSafetyMode(userId: string): Promise<WomenSafetyPreference> {
    return this.updatePreferences(userId, {
      womenSafetyModeEnabled: false,
      genderPreference: "NO_PREFERENCE",
      pinVerificationEnabled: false,
    });
  }

  private createDefaultPreferences(userId: string): WomenSafetyPreference {
    return {
      userId,
      womenSafetyModeEnabled: false,
      genderPreference: "NO_PREFERENCE",
      autoShareTrips: false,
      autoShareContacts: [],
      pinVerificationEnabled: false,
      trustedContacts: [],
      safeWords: [],
      quietHoursEnabled: false,
      preferVerifiedDrivers: false,
    };
  }

  // ---------------------------------------------------------------------------
  // FEMALE DRIVER MATCHING
  // ---------------------------------------------------------------------------

  async findFemaleDrivers(
    params: FindFemaleDriversParams,
  ): Promise<FemaleDriverMatch[]> {
    const { location, radius = 5000, minRating = 4, maxResults = 10 } = params;

    const matches: FemaleDriverMatch[] = [];

    for (const driver of this.femaleDrivers.values()) {
      if (!driver.isAvailable || !driver.isActive) continue;

      // Calculate distance
      const distance = this.calculateDistance(location, driver.currentLocation);

      if (distance <= radius && driver.rating >= minRating) {
        matches.push({
          driverId: driver.driverId,
          distance,
          eta: Math.ceil(distance / 500), // Rough ETA in minutes
          rating: driver.rating,
          tripsCompleted: driver.tripsCompleted,
          verifiedFemale: driver.genderVerified,
        });
      }
    }

    // Sort by distance and verified status
    const sorted = matches.toSorted((a, b) => {
      // Prefer verified drivers
      if (a.verifiedFemale && !b.verifiedFemale) return -1;
      if (!a.verifiedFemale && b.verifiedFemale) return 1;
      // Then by distance
      return a.distance - b.distance;
    });

    return sorted.slice(0, maxResults);
  }

  async registerFemaleDriver(
    driverId: string,
    verification: FemaleDriverVerification,
  ): Promise<boolean> {
    // Verify gender through document verification or self-declaration + review
    const isVerified =
      verification.method === "document" ||
      (verification.method === "selfie" && verification.manuallyReviewed);

    const profile: FemaleDriverProfile = {
      driverId,
      genderVerified: isVerified ?? false,
      verificationMethod: verification.method,
      registeredAt: new Date(),
      isActive: true,
      isAvailable: false,
      currentLocation: { lat: 0, lng: 0 },
      rating: 5,
      tripsCompleted: 0,
    };

    this.femaleDrivers.set(driverId, profile);

    womenSafetyLogger.info(
      { driverId, isVerified },
      "[WomenSafety] Female driver registered",
    );

    return true;
  }

  async updateDriverAvailability(
    driverId: string,
    isAvailable: boolean,
    location?: Location,
  ): Promise<void> {
    const driver = this.femaleDrivers.get(driverId);

    if (driver) {
      driver.isAvailable = isAvailable;
      if (location) {
        driver.currentLocation = location;
      }
    }
  }

  async checkGenderPreferenceMatch(
    riderId: string,
    driverId: string,
  ): Promise<PreferenceMatchResult> {
    const prefs = await this.getPreferences(riderId);

    if (
      !prefs.womenSafetyModeEnabled ||
      prefs.genderPreference === "NO_PREFERENCE"
    ) {
      return { matches: true, preference: "NO_PREFERENCE" };
    }

    if (prefs.genderPreference === "FEMALE_ONLY") {
      const femaleDriver = this.femaleDrivers.get(driverId);
      return {
        matches: !!femaleDriver,
        preference: "FEMALE_ONLY",
        driverIsFemale: !!femaleDriver,
        driverVerified: femaleDriver?.genderVerified || false,
      };
    }

    // SAME_GENDER would need rider gender check (not implemented here)
    return { matches: true, preference: prefs.genderPreference };
  }

  // ---------------------------------------------------------------------------
  // PIN VERIFICATION
  // ---------------------------------------------------------------------------

  async generateTripPin(
    tripId: string,
    riderId: string,
  ): Promise<TripPinVerification> {
    const prefs = await this.getPreferences(riderId);

    if (!prefs.pinVerificationEnabled) {
      // Generate anyway in case it's a night trip or high-risk area
      womenSafetyLogger.info(
        "[WomenSafety] PIN generated despite preference off (safety override)",
      );
    }

    const pin = this.generatePin();
    const verification: TripPinVerification = {
      tripId,
      pin,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      verified: false,
    };

    this.activePins.set(tripId, verification);

    // Send PIN to rider
    await this.sendPinToRider(riderId, pin);

    womenSafetyLogger.info({ tripId }, "[WomenSafety] Trip PIN generated");

    return {
      ...verification,
      pin: this.maskPin(pin), // Return masked PIN for response
    };
  }

  async verifyTripPin(
    tripId: string,
    enteredPin: string,
  ): Promise<PinVerificationResult> {
    const verification = this.activePins.get(tripId);

    if (!verification) {
      return { valid: false, error: "PIN not found" };
    }

    if (verification.expiresAt < new Date()) {
      this.activePins.delete(tripId);
      return { valid: false, error: "PIN expired" };
    }

    if (verification.pin !== enteredPin) {
      return { valid: false, error: "Invalid PIN" };
    }

    verification.verified = true;

    womenSafetyLogger.info({ tripId }, "[WomenSafety] PIN verified for trip");

    this.emit("pin_verified", { tripId });

    return { valid: true };
  }

  async shouldRequirePin(
    riderId: string,
    tripDetails: TripDetails,
  ): Promise<boolean> {
    const prefs = await this.getPreferences(riderId);

    // Always require if preference is on
    if (prefs.pinVerificationEnabled) return true;

    // Check time-based rules
    const hour = new Date().getHours();
    const isNightTime = hour >= 22 || hour < 6;

    // Auto-enable for night trips
    if (isNightTime) return true;

    // Check if route goes through high-risk areas
    if (tripDetails.hasHighRiskZones) return true;

    // Check quiet hours
    if (prefs.quietHoursEnabled && this.isInQuietHours(prefs)) return true;

    return false;
  }

  private generatePin(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  private maskPin(pin: string): string {
    return pin; // In production, might partially mask for display
  }

  private async sendPinToRider(riderId: string, _pin: string): Promise<void> {
    // In production, send via push notification and SMS
    womenSafetyLogger.info(
      { riderId: riderId.slice(-4) },
      "[WomenSafety] PIN sent to rider",
    );
  }

  // ---------------------------------------------------------------------------
  // AUTO TRIP SHARING
  // ---------------------------------------------------------------------------

  async setupAutoShare(userId: string, contactIds: string[]): Promise<void> {
    await this.updatePreferences(userId, {
      autoShareTrips: true,
      autoShareContacts: contactIds,
    });

    womenSafetyLogger.info(
      { contactCount: contactIds.length },
      "[WomenSafety] Auto-share configured",
    );
  }

  async autoShareTrip(
    tripId: string,
    riderId: string,
  ): Promise<TripShareSession | null> {
    const prefs = await this.getPreferences(riderId);

    if (!prefs.autoShareTrips || prefs.autoShareContacts.length === 0) {
      return null;
    }

    const shareLink = await this.generateShareLink(tripId);

    const session: TripShareSession = {
      tripId,
      riderId,
      shareLink,
      sharedWith: prefs.autoShareContacts,
      sharedAt: new Date(),
      isActive: true,
    };

    this.tripShareSessions.set(tripId, session);

    // Notify all contacts
    for (const contactId of prefs.autoShareContacts) {
      await this.notifyContactOfTripShare(contactId, riderId, shareLink);
    }

    womenSafetyLogger.info(
      { contactCount: prefs.autoShareContacts.length },
      "[WomenSafety] Trip auto-shared",
    );

    return session;
  }

  async shareWithContact(
    tripId: string,
    riderId: string,
    contactId: string,
  ): Promise<boolean> {
    const shareLink = await this.generateShareLink(tripId);

    let session = this.tripShareSessions.get(tripId);

    if (!session) {
      session = {
        tripId,
        riderId,
        shareLink,
        sharedWith: [],
        sharedAt: new Date(),
        isActive: true,
      };
      this.tripShareSessions.set(tripId, session);
    }

    if (!session.sharedWith.includes(contactId)) {
      session.sharedWith.push(contactId);
    }

    await this.notifyContactOfTripShare(contactId, riderId, shareLink);

    return true;
  }

  async endTripShare(tripId: string): Promise<void> {
    const session = this.tripShareSessions.get(tripId);

    if (session) {
      session.isActive = false;

      // Notify contacts that trip ended safely
      for (const contactId of session.sharedWith) {
        await this.notifyContactTripEnded(contactId, session.riderId);
      }

      this.tripShareSessions.delete(tripId);
    }
  }

  private async generateShareLink(_tripId: string): Promise<string> {
    const token = crypto.randomBytes(16).toString("hex");
    return `https://ubi.app/trip/track/${token}`;
  }

  private async notifyContactOfTripShare(
    contactId: string,
    _riderId: string,
    _shareLink: string,
  ): Promise<void> {
    // In production, send SMS/WhatsApp with share link
    womenSafetyLogger.info(
      { contactId },
      "[WomenSafety] Contact notified of trip share",
    );
  }

  private async notifyContactTripEnded(
    contactId: string,
    _riderId: string,
  ): Promise<void> {
    // In production, send notification that trip ended safely
    womenSafetyLogger.info(
      { contactId },
      "[WomenSafety] Contact notified trip ended safely",
    );
  }

  // ---------------------------------------------------------------------------
  // SAFE WORD DETECTION
  // ---------------------------------------------------------------------------

  async setSafeWords(userId: string, words: string[]): Promise<void> {
    const normalized = words.map((w) => w.toLowerCase().trim());
    this.safeWords.set(userId, normalized);

    await this.updatePreferences(userId, { safeWords: normalized });

    womenSafetyLogger.info({ userId }, "[WomenSafety] Safe words configured");
  }

  async detectSafeWord(
    userId: string,
    message: string,
  ): Promise<SafeWordDetectionResult> {
    const words = this.safeWords.get(userId) || [];

    if (words.length === 0) {
      return { detected: false };
    }

    const normalizedMessage = message.toLowerCase();

    for (const word of words) {
      if (normalizedMessage.includes(word)) {
        womenSafetyLogger.info({ userId }, "[WomenSafety] SAFE WORD DETECTED");

        this.emit("safe_word_detected", { userId, word, message });

        return {
          detected: true,
          word,
          action: "trigger_silent_sos",
        };
      }
    }

    return { detected: false };
  }

  async triggerSilentSOS(userId: string, tripId?: string): Promise<void> {
    // Trigger SOS without alerting driver
    this.emit("silent_sos", { userId, tripId, timestamp: new Date() });

    womenSafetyLogger.info({ userId }, "[WomenSafety] Silent SOS triggered");
  }

  // ---------------------------------------------------------------------------
  // QUIET HOURS
  // ---------------------------------------------------------------------------

  async configureQuietHours(
    userId: string,
    enabled: boolean,
    start?: string, // Format: "HH:MM"
    end?: string,
  ): Promise<void> {
    await this.updatePreferences(userId, {
      quietHoursEnabled: enabled,
      quietHoursStart: start,
      quietHoursEnd: end,
    });

    womenSafetyLogger.info(
      { quietHours: enabled ? `${start} - ${end}` : "disabled" },
      "[WomenSafety] Quiet hours configured",
    );
  }

  private isInQuietHours(prefs: WomenSafetyPreference): boolean {
    if (
      !prefs.quietHoursEnabled ||
      !prefs.quietHoursStart ||
      !prefs.quietHoursEnd
    ) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const startParts = prefs.quietHoursStart.split(":").map(Number);
    const endParts = prefs.quietHoursEnd.split(":").map(Number);

    const startHour = startParts[0];
    const startMin = startParts[1];
    const endHour = endParts[0];
    const endMin = endParts[1];

    if (
      startHour === undefined ||
      startMin === undefined ||
      endHour === undefined ||
      endMin === undefined
    ) {
      return false;
    }

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 22:00 - 06:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }

    return currentTime >= startTime && currentTime < endTime;
  }

  // ---------------------------------------------------------------------------
  // TRUSTED CONTACTS
  // ---------------------------------------------------------------------------

  async addTrustedContact(
    userId: string,
    contact: TrustedContactInput,
  ): Promise<string> {
    const prefs = await this.getPreferences(userId);

    const contactId = `tc_${crypto.randomBytes(8).toString("hex")}`;

    prefs.trustedContacts.push(contactId);
    this.userPreferences.set(userId, prefs);

    // In production, store contact details
    womenSafetyLogger.info(
      { contactName: contact.name },
      "[WomenSafety] Trusted contact added",
    );

    return contactId;
  }

  async removeTrustedContact(userId: string, contactId: string): Promise<void> {
    const prefs = await this.getPreferences(userId);

    prefs.trustedContacts = prefs.trustedContacts.filter(
      (id) => id !== contactId,
    );
    prefs.autoShareContacts = prefs.autoShareContacts.filter(
      (id) => id !== contactId,
    );

    this.userPreferences.set(userId, prefs);
  }

  async getTrustedContacts(_userId: string): Promise<EmergencyContact[]> {
    // In production, fetch from database
    return [];
  }

  // ---------------------------------------------------------------------------
  // VERIFIED DRIVER PREFERENCE
  // ---------------------------------------------------------------------------

  async checkVerifiedDriverRequirement(
    riderId: string,
    driverId: string,
  ): Promise<VerifiedDriverCheckResult> {
    const prefs = await this.getPreferences(riderId);

    if (!prefs.preferVerifiedDrivers) {
      return { required: false, driverMeetsRequirement: true };
    }

    // Check driver's verification level
    const driverVerified = await this.isDriverFullyVerified(driverId);

    return {
      required: true,
      driverMeetsRequirement: driverVerified,
      driverVerificationLevel: driverVerified ? "DRIVER" : "BASIC",
    };
  }

  private async isDriverFullyVerified(_driverId: string): Promise<boolean> {
    // In production, check driver's verification status
    return true;
  }

  // ---------------------------------------------------------------------------
  // ENHANCED NIGHT MONITORING
  // ---------------------------------------------------------------------------

  async getNightSafetyEnhancements(
    riderId: string,
  ): Promise<NightSafetyConfig> {
    const prefs = await this.getPreferences(riderId);
    const hour = new Date().getHours();
    const isNightTime = hour >= 22 || hour < 6;

    if (!isNightTime && !prefs.womenSafetyModeEnabled) {
      return {
        isNightMode: false,
        enhancements: [],
      };
    }

    const enhancements: string[] = [];

    if (isNightTime) {
      enhancements.push(
        "pin_verification",
        "auto_share_contacts",
        "enhanced_monitoring",
        "prefer_verified_drivers",
      );
    }

    if (prefs.womenSafetyModeEnabled) {
      enhancements.push("female_driver_preference", "safe_word_detection");
    }

    return {
      isNightMode: isNightTime,
      enhancements: [...new Set(enhancements)],
      autoShareEnabled: prefs.autoShareTrips,
      contactsToNotify: prefs.autoShareContacts.length,
    };
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

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

  private initializeFemaleDriverRegistry(): void {
    // In production, load from database
    womenSafetyLogger.info("[WomenSafety] Female driver registry initialized");
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface FindFemaleDriversParams {
  location: Location;
  radius?: number;
  minRating?: number;
  maxResults?: number;
}

interface FemaleDriverProfile {
  driverId: string;
  genderVerified: boolean;
  verificationMethod: "document" | "selfie" | "self_declared";
  registeredAt: Date;
  isActive: boolean;
  isAvailable: boolean;
  currentLocation: Location;
  rating: number;
  tripsCompleted: number;
}

interface FemaleDriverVerification {
  method: "document" | "selfie" | "self_declared";
  documentId?: string;
  selfieId?: string;
  manuallyReviewed?: boolean;
}

interface PreferenceMatchResult {
  matches: boolean;
  preference: GenderPreference;
  driverIsFemale?: boolean;
  driverVerified?: boolean;
}

interface TripDetails {
  pickupLocation: Location;
  dropoffLocation: Location;
  estimatedDuration: number;
  hasHighRiskZones: boolean;
}

interface PinVerificationResult {
  valid: boolean;
  error?: string;
}

interface TripShareSession {
  tripId: string;
  riderId: string;
  shareLink: string;
  sharedWith: string[];
  sharedAt: Date;
  isActive: boolean;
}

interface SafeWordDetectionResult {
  detected: boolean;
  word?: string;
  action?: string;
}

interface TrustedContactInput {
  name: string;
  phoneNumber: string;
  relationship?: string;
  enableWhatsApp?: boolean;
}

interface VerifiedDriverCheckResult {
  required: boolean;
  driverMeetsRequirement: boolean;
  driverVerificationLevel?: string;
}

interface NightSafetyConfig {
  isNightMode: boolean;
  enhancements: string[];
  autoShareEnabled?: boolean;
  contactsToNotify?: number;
}

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const womenSafetyService = new WomenSafetyService();
