/**
 * UBI Safety & Trust Platform - Type Definitions
 *
 * Comprehensive types for:
 * - Identity Verification
 * - Trip Safety Monitoring
 * - SOS Emergency Response
 * - Women Safety Features
 * - Fraud Prevention
 * - Driver Safety
 * - Background Checks
 */

// =============================================================================
// VERIFICATION TYPES
// =============================================================================

export type VerificationLevel =
  | "BASIC"
  | "VERIFIED"
  | "DRIVER"
  | "MERCHANT"
  | "PREMIUM";

export type VerificationType =
  | "PHONE"
  | "EMAIL"
  | "GOVERNMENT_ID"
  | "DRIVERS_LICENSE"
  | "SELFIE"
  | "LIVENESS"
  | "ADDRESS"
  | "VEHICLE"
  | "INSURANCE"
  | "BACKGROUND_CHECK"
  | "BIOMETRIC";

export type VerificationStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "NEEDS_REVIEW";

export type DocumentType =
  // Nigeria
  | "BVN"
  | "NIN"
  | "VOTERS_CARD"
  | "DRIVERS_LICENSE_NG"
  | "INTERNATIONAL_PASSPORT_NG"
  // Kenya
  | "NATIONAL_ID_KE"
  | "KRA_PIN"
  | "DRIVERS_LICENSE_KE"
  // South Africa
  | "RSA_ID"
  | "DRIVERS_LICENSE_ZA"
  // Ghana
  | "GHANA_CARD"
  | "VOTERS_ID_GH"
  | "DRIVERS_LICENSE_GH"
  // Rwanda
  | "NATIONAL_ID_RW"
  // Ethiopia
  | "NATIONAL_ID_ET"
  // Generic
  | "PASSPORT"
  | "UTILITY_BILL"
  | "BANK_STATEMENT";

export interface VerificationLevelConfig {
  level: VerificationLevel;
  name: string;
  description?: string;
  requirements: VerificationRequirements;
  capabilities: VerificationCapabilities;
  dailyLimit?: number;
  monthlyLimit?: number;
}

export interface VerificationRequirements {
  phone: boolean;
  email: boolean;
  governmentId: boolean;
  selfie: boolean;
  liveness: boolean;
  driversLicense: boolean;
  backgroundCheck: boolean;
  vehicleDocs: boolean;
  address: boolean;
}

export interface VerificationCapabilities {
  canRide: boolean;
  canDrive: boolean;
  canSendMoney: boolean;
  canReceiveMoney: boolean;
  canAccessEarnings: boolean;
  canMerchant: boolean;
  dailyLimit: number;
  monthlyLimit: number;
}

export interface UserVerification {
  id: string;
  userId: string;
  verificationType: VerificationType;
  status: VerificationStatus;
  provider?: string;
  providerReference?: string;
  documentType?: DocumentType;
  documentCountry?: string;
  documentExpiry?: Date;
  confidenceScore?: number;
  rejectionReason?: string;
  attempts: number;
  maxAttempts: number;
  verifiedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export interface DocumentSubmission {
  userId: string;
  documentType: DocumentType;
  country: string;
  documentFront: Buffer;
  documentBack?: Buffer;
  metadata?: Record<string, any>;
}

export interface VerificationResult {
  success: boolean;
  verification: UserVerification;
  extractedData?: ExtractedDocumentData;
  confidenceScore: number;
  issues?: VerificationIssue[];
}

export interface ExtractedDocumentData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  documentNumber?: string;
  expiryDate?: string;
  issueDate?: string;
  address?: string;
  gender?: string;
  nationality?: string;
  photoExtracted?: boolean;
}

export interface VerificationIssue {
  code: string;
  message: string;
  field?: string;
  severity: "warning" | "error";
}

// Liveness & Biometrics
export interface LivenessResult {
  isLive: boolean;
  score: number;
  checks: LivenessCheck[];
  spoofingDetected: boolean;
  spoofingType?: string;
}

export interface LivenessCheck {
  type: "blink" | "head_movement" | "expression" | "anti_spoofing" | "depth";
  passed: boolean;
  score: number;
  details?: string;
}

export interface FaceMatchResult {
  matched: boolean;
  matchScore: number;
  threshold: number;
  selfieQuality: number;
  documentPhotoQuality: number;
}

export interface SelfieCapture {
  id: string;
  userId: string;
  storagePath: string;
  qualityScore: number;
  faceDetected: boolean;
  multipleFaces: boolean;
}

// =============================================================================
// BACKGROUND CHECK TYPES
// =============================================================================

export type BackgroundCheckType =
  | "CRIMINAL_RECORD"
  | "DRIVING_RECORD"
  | "CREDIT_CHECK"
  | "EMPLOYMENT"
  | "EDUCATION"
  | "REFERENCE"
  | "SEX_OFFENDER"
  | "WATCHLIST";

export type BackgroundCheckStatus =
  | "INITIATED"
  | "PENDING_DOCUMENTS"
  | "IN_PROGRESS"
  | "COMPLETED_CLEAR"
  | "COMPLETED_REVIEW"
  | "COMPLETED_FAIL"
  | "EXPIRED";

export interface BackgroundCheck {
  id: string;
  userId: string;
  checkType: BackgroundCheckType;
  status: BackgroundCheckStatus;
  provider: string;
  providerReference?: string;
  country: string;
  consentGiven: boolean;
  findings?: BackgroundCheckFinding[];
  hasCriticalFindings: boolean;
  validUntil?: Date;
  completedAt?: Date;
}

export interface BackgroundCheckFinding {
  type: string;
  severity: "info" | "warning" | "critical";
  description: string;
  date?: string;
  source?: string;
  jurisdiction?: string;
}

export interface BackgroundCheckRequest {
  userId: string;
  checkTypes: BackgroundCheckType[];
  country: string;
  idNumber: string;
  idType: DocumentType;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  consentGiven: boolean;
}

// =============================================================================
// SOS & EMERGENCY TYPES
// =============================================================================

export type SOSStatus =
  | "ACTIVE"
  | "RESPONDED"
  | "RESOLVED"
  | "CANCELLED"
  | "ESCALATED"
  | "FALSE_ALARM";

export type SOSEscalationLevel = "LEVEL_1" | "LEVEL_2" | "LEVEL_3" | "LEVEL_4";

export type SOSTrigger =
  | "button"
  | "voice"
  | "shake"
  | "auto"
  | "crash_detected"
  | "timer"
  | "accident_detection";

export interface SOSIncident {
  id: string;
  userId: string;
  tripId?: string;
  driverId?: string;
  status: SOSStatus;
  escalationLevel: SOSEscalationLevel;
  triggerMethod: SOSTrigger;
  triggerLocation: Location;
  currentLocation?: Location;
  batteryLevel?: number;
  networkType?: string;
  audioRecordingUrl?: string;
  assignedAgentId?: string;
  firstResponseAt?: Date;
  responseTimeSeconds?: number;
  resolvedAt?: Date;
  resolutionType?: string;
  triggeredAt: Date;
}

export interface SOSResponse {
  incidentId: string;
  agentId: string;
  action: "acknowledge" | "contact_user" | "escalate" | "dispatch" | "resolve";
  notes?: string;
  contactAttempts?: number;
  escalationReason?: string;
}

export interface EmergencyContact {
  id: string;
  userId: string;
  name: string;
  phoneNumber: string;
  relationship?: string;
  isPrimary: boolean;
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  emailEnabled: boolean;
  email?: string;
  notifyOnTrip: boolean;
  isVerified: boolean;
}

export interface EmergencyNotification {
  contactId: string;
  channel: "sms" | "whatsapp" | "call" | "email" | "push";
  status: "sent" | "delivered" | "read" | "failed";
  locationLink?: string;
  sentAt: Date;
  deliveredAt?: Date;
}

// =============================================================================
// TRIP SAFETY TYPES
// =============================================================================

export interface Location {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  bearing?: number;
  altitude?: number;
  timestamp?: Date;
}

export type TripAnomalyType =
  | "ROUTE_DEVIATION"
  | "UNEXPECTED_STOP"
  | "EXCESSIVE_SPEED"
  | "UNUSUAL_DURATION"
  | "LOCATION_JUMP"
  | "CRASH_DETECTED"
  | "PHONE_INACTIVE"
  | "DRIVER_UNRESPONSIVE";

export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface TripSafetySession {
  id: string;
  tripId: string;
  riderId: string;
  driverId: string;
  status: "monitoring" | "completed" | "incident";
  expectedRoute: Location[];
  expectedDuration: number;
  riskScore: number;
  anomalyCount: number;
  womenSafetyMode: boolean;
  pinVerified?: boolean;
  sharedWithContacts: boolean;
  monitoringStartedAt: Date;
}

export interface TripAnomaly {
  id: string;
  tripId: string;
  anomalyType: TripAnomalyType;
  severity: IncidentSeverity;
  details: AnomalyDetails;
  location?: Location;
  detectedAt: Date;
  resolvedAt?: Date;
  resolutionType?: "auto_resolved" | "user_confirmed" | "escalated";
}

export interface AnomalyDetails {
  // Route deviation
  distanceFromRoute?: number;
  deviationDuration?: number;
  // Unexpected stop
  stopDuration?: number;
  expectedStopTime?: number;
  // Speed
  currentSpeed?: number;
  expectedSpeed?: number;
  speedLimit?: number;
  // Crash
  impactForce?: number;
  speedDrop?: number;
  // General
  description?: string;
  confidence?: number;
}

export interface CrashDetection {
  type: "potential_crash";
  severity: "critical";
  impactForce: number;
  speedDrop: number;
  location: Location;
  timestamp: Date;
  accelerometerData?: AccelData;
}

export interface AccelData {
  x: number;
  y: number;
  z: number;
  timestamp: Date;
  currentSpeed: number;
  location: Location;
}

export type SafetyCheckStatus =
  | "SENT"
  | "ACKNOWLEDGED"
  | "CONFIRMED_SAFE"
  | "NO_RESPONSE"
  | "HELP_REQUESTED"
  | "ESCALATED";

export interface TripSafetyCheck {
  id: string;
  tripId: string;
  userId: string;
  reason: string;
  status: SafetyCheckStatus;
  sentAt: Date;
  respondedAt?: Date;
  responseType?: "safe" | "need_help" | "no_response";
  timeoutSeconds: number;
}

export interface TripShare {
  id: string;
  tripId: string;
  sharedBy: string;
  shareType: "link" | "contact" | "emergency";
  shareLink?: string;
  contactId?: string;
  expiresAt?: Date;
  isActive: boolean;
}

// =============================================================================
// INCIDENT TYPES
// =============================================================================

export type IncidentType =
  | "SOS_TRIGGERED"
  | "CRASH_DETECTED"
  | "ROUTE_DEVIATION"
  | "UNEXPECTED_STOP"
  | "SPEED_ANOMALY"
  | "SAFETY_CHECK_FAILED"
  | "ASSAULT"
  | "ROBBERY"
  | "ACCIDENT"
  | "HARASSMENT"
  | "DRIVER_MISCONDUCT"
  | "RIDER_MISCONDUCT"
  | "VEHICLE_ISSUE"
  | "OTHER";

export type IncidentStatus =
  | "REPORTED"
  | "ACKNOWLEDGED"
  | "INVESTIGATING"
  | "RESOLVED"
  | "CLOSED"
  | "ESCALATED";

export interface SafetyIncident {
  id: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reportedBy: string;
  reporterType: "rider" | "driver" | "system" | "agent";
  tripId?: string;
  riderId?: string;
  driverId?: string;
  location?: Location;
  description?: string;
  evidenceUrls: string[];
  assignedAgentId?: string;
  resolvedAt?: Date;
  resolutionSummary?: string;
  reportedAt: Date;
}

export interface IncidentReport {
  incidentType: IncidentType;
  severity: IncidentSeverity;
  tripId?: string;
  description: string;
  location?: Location;
  evidence?: Buffer[];
}

// =============================================================================
// FRAUD DETECTION TYPES
// =============================================================================

export type FraudSignalType =
  | "NEW_DEVICE"
  | "IMPOSSIBLE_TRAVEL"
  | "SIM_SWAP"
  | "PASSWORD_RESET"
  | "MULTI_ACCOUNT"
  | "PROMO_ABUSE"
  | "CIRCULAR_REFERRAL"
  | "VELOCITY_BREACH"
  | "DEVICE_REPUTATION"
  | "IP_REPUTATION"
  | "BEHAVIORAL_ANOMALY"
  | "COLLUSION"
  | "FAKE_GPS"
  | "EMULATOR";

export type FraudActionType =
  | "ALLOW"
  | "CHALLENGE"
  | "BLOCK"
  | "FLAG_FOR_REVIEW"
  | "RESTRICT"
  | "SUSPEND"
  | "TERMINATE";

export type RiskLevel =
  | "VERY_LOW"
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "VERY_HIGH"
  | "CRITICAL";

export interface FraudEvent {
  userId: string;
  eventType: string;
  deviceInfo?: DeviceInfo;
  ipAddress?: string;
  geoLocation?: Location;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
  recommendation: FraudActionType;
  requiresChallenge: boolean;
  challengeType?: "otp" | "biometric" | "security_question";
}

export interface RiskSignal {
  type: FraudSignalType;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  details: Record<string, any>;
  timestamp: Date;
}

export interface DeviceInfo {
  deviceId: string;
  deviceType: "ios" | "android" | "web";
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  manufacturer?: string;
  model?: string;
  screenResolution?: string;
  language?: string;
  timezone?: string;
  isEmulator?: boolean;
  isRooted?: boolean;
  hasVpn?: boolean;
  hasMockLocation?: boolean;
}

export interface DeviceFingerprint extends DeviceInfo {
  id: string;
  userId: string;
  trustScore: number;
  riskFlags: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface ATODetection {
  detected: boolean;
  signals: ATOSignal[];
  recommendation: "allow" | "challenge" | "block_and_verify";
  riskScore: number;
}

export interface ATOSignal {
  type:
    | "recent_phone_change"
    | "recent_password_reset"
    | "new_device"
    | "impossible_travel"
    | "sim_swap";
  severity: "low" | "medium" | "high";
  details: Record<string, any>;
}

export interface AbuseDetection {
  detected: boolean;
  signals: AbuseSignal[];
  recommendation: "allow" | "block_promo" | "flag_account" | "suspend";
  abuseScore: number;
}

export interface AbuseSignal {
  type:
    | "multi_account_device"
    | "circular_referral"
    | "excessive_promo_usage"
    | "velocity_abuse"
    | "fake_trip";
  severity: "low" | "medium" | "high" | "critical";
  details: Record<string, any>;
}

export interface FakeDriverDetection {
  detected: boolean;
  signals: FakeDriverSignal[];
  recommendation: "clear" | "investigate" | "suspend";
  suspicionScore: number;
}

export interface FakeDriverSignal {
  type:
    | "excessive_short_trips"
    | "repeated_locations"
    | "rider_collusion"
    | "gps_spoofing"
    | "photo_mismatch";
  severity: "medium" | "high" | "critical";
  details: Record<string, any>;
}

export interface CollusionDetection {
  detected: boolean;
  collusionType: "driver_rider" | "multi_driver" | "organized_fraud";
  participants: string[];
  evidenceScore: number;
  tripIds: string[];
}

export interface UserRiskProfile {
  userId: string;
  overallRiskScore: number;
  riskLevel: RiskLevel;
  verificationLevel: VerificationLevel;
  accountAge: number;
  fraudEventsCount: number;
  promoAbuseFlags: number;
  deviceCount: number;
  isUnderReview: boolean;
  isRestricted: boolean;
  isSuspended: boolean;
}

// =============================================================================
// DRIVER SAFETY TYPES
// =============================================================================

export interface DriverSafetyProfile {
  driverId: string;
  safetyScore: number;
  totalTrips: number;
  incidentsReported: number;
  incidentsConfirmed: number;
  complaintsReceived: number;
  averageRating?: number;
  speedingIncidents: number;
  hardBrakingCount: number;
  acceptsCash: boolean;
  cashlessOnly: boolean;
  preferredAreas?: Location[];
  avoidedAreas?: Location[];
  backgroundClear: boolean;
  isVerified: boolean;
}

export interface RiskZone {
  id: string;
  name: string;
  center: Location;
  radius?: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
  incidentCount: number;
  advisoryText?: string;
  restrictions?: ZoneRestrictions;
}

export interface ZoneRestrictions {
  cashRestricted: boolean;
  nightRestricted: boolean;
  requiresVerifiedDriver: boolean;
  requiresVerifiedRider: boolean;
  maxWaitTime?: number;
}

export interface DriverIncident {
  id: string;
  driverId: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  tripId?: string;
  description: string;
  location?: Location;
  status: IncidentStatus;
  resolution?: string;
  actionTaken?: string;
  reportedAt: Date;
}

// =============================================================================
// WOMEN SAFETY TYPES
// =============================================================================

export type GenderPreference =
  | "NO_PREFERENCE"
  | "SAME_GENDER"
  | "FEMALE_ONLY"
  | "MALE_ONLY";

export interface WomenSafetyPreference {
  userId: string;
  womenSafetyModeEnabled: boolean;
  genderPreference: GenderPreference;
  autoShareTrips: boolean;
  autoShareContacts: string[];
  pinVerificationEnabled: boolean;
  trustedContacts: string[];
  safeWords: string[];
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  preferVerifiedDrivers: boolean;
}

export interface TripPinVerification {
  tripId: string;
  pin: string;
  expiresAt: Date;
  verified: boolean;
}

export interface FemaleDriverMatch {
  driverId: string;
  distance: number;
  eta: number;
  rating: number;
  tripsCompleted: number;
  verifiedFemale: boolean;
}

// =============================================================================
// SAFETY AGENT TYPES
// =============================================================================

export interface SafetyAgent {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "agent" | "senior_agent" | "manager";
  team: "sos_response" | "fraud" | "investigations" | "general";
  country?: string;
  city?: string;
  isOnDuty: boolean;
  activeIncidents: number;
  maxIncidents: number;
  totalResolved: number;
  avgResponseTime?: number;
}

export interface SafetyDashboardAlert {
  type: "sos" | "crash" | "anomaly" | "fraud" | "incident";
  priority: "low" | "medium" | "high" | "critical";
  incident: SOSIncident | SafetyIncident;
  tripDetails?: TripSafetySession;
  userDetails?: UserSafetyContext;
}

export interface UserSafetyContext {
  userId: string;
  name: string;
  phone: string;
  verificationLevel: VerificationLevel;
  riskLevel: RiskLevel;
  previousIncidents: number;
  emergencyContacts: EmergencyContact[];
}

// =============================================================================
// VERIFICATION PROVIDER INTERFACES
// =============================================================================

export interface VerificationProvider {
  name: string;
  supportedCountries: string[];
  supportedDocuments: DocumentType[];

  verify(params: ProviderVerifyParams): Promise<ProviderVerifyResult>;
  checkStatus(reference: string): Promise<ProviderStatusResult>;
}

export interface ProviderVerifyParams {
  document: Buffer;
  documentType: DocumentType;
  country: string;
  additionalDocuments?: Buffer[];
  metadata?: Record<string, any>;
}

export interface ProviderVerifyResult {
  reference: string;
  status: "pending" | "approved" | "rejected" | "needs_review";
  confidenceScore?: number;
  extractedData?: ExtractedDocumentData;
  issues?: VerificationIssue[];
  rawResponse?: Record<string, any>;
}

export interface ProviderStatusResult {
  reference: string;
  status: "pending" | "approved" | "rejected" | "expired";
  updatedAt: Date;
}

// =============================================================================
// COUNTRY-SPECIFIC CONFIGURATIONS
// =============================================================================

export interface CountryVerificationConfig {
  country: string;
  countryName: string;
  supportedDocuments: DocumentType[];
  primaryIdDocument: DocumentType;
  requiredForRider: DocumentType[];
  requiredForDriver: DocumentType[];
  backgroundCheckProvider: string;
  verificationProviders: string[];
  emergencyNumber: string;
  policeNumber: string;
  dataProtectionLaw: string;
  consentRequirements: string[];
}

export const COUNTRY_CONFIGS: Record<string, CountryVerificationConfig> = {
  NG: {
    country: "NG",
    countryName: "Nigeria",
    supportedDocuments: [
      "BVN",
      "NIN",
      "VOTERS_CARD",
      "DRIVERS_LICENSE_NG",
      "INTERNATIONAL_PASSPORT_NG",
    ],
    primaryIdDocument: "NIN",
    requiredForRider: ["NIN"],
    requiredForDriver: ["NIN", "DRIVERS_LICENSE_NG"],
    backgroundCheckProvider: "nigeria_police",
    verificationProviders: ["smile_id", "youverify", "verified_africa"],
    emergencyNumber: "112",
    policeNumber: "199",
    dataProtectionLaw: "NDPR",
    consentRequirements: [
      "data_processing",
      "background_check",
      "location_tracking",
    ],
  },
  KE: {
    country: "KE",
    countryName: "Kenya",
    supportedDocuments: [
      "NATIONAL_ID_KE",
      "KRA_PIN",
      "DRIVERS_LICENSE_KE",
      "PASSPORT",
    ],
    primaryIdDocument: "NATIONAL_ID_KE",
    requiredForRider: ["NATIONAL_ID_KE"],
    requiredForDriver: ["NATIONAL_ID_KE", "DRIVERS_LICENSE_KE"],
    backgroundCheckProvider: "kenya_police",
    verificationProviders: ["iprs", "smile_id"],
    emergencyNumber: "999",
    policeNumber: "999",
    dataProtectionLaw: "Data Protection Act 2019",
    consentRequirements: ["data_processing", "background_check"],
  },
  ZA: {
    country: "ZA",
    countryName: "South Africa",
    supportedDocuments: ["RSA_ID", "DRIVERS_LICENSE_ZA", "PASSPORT"],
    primaryIdDocument: "RSA_ID",
    requiredForRider: ["RSA_ID"],
    requiredForDriver: ["RSA_ID", "DRIVERS_LICENSE_ZA"],
    backgroundCheckProvider: "saps",
    verificationProviders: ["xds", "home_affairs", "smile_id"],
    emergencyNumber: "10111",
    policeNumber: "10111",
    dataProtectionLaw: "POPIA",
    consentRequirements: ["popia_consent", "background_check"],
  },
  GH: {
    country: "GH",
    countryName: "Ghana",
    supportedDocuments: [
      "GHANA_CARD",
      "VOTERS_ID_GH",
      "DRIVERS_LICENSE_GH",
      "PASSPORT",
    ],
    primaryIdDocument: "GHANA_CARD",
    requiredForRider: ["GHANA_CARD"],
    requiredForDriver: ["GHANA_CARD", "DRIVERS_LICENSE_GH"],
    backgroundCheckProvider: "ghana_police",
    verificationProviders: ["nia", "smile_id"],
    emergencyNumber: "999",
    policeNumber: "191",
    dataProtectionLaw: "Data Protection Act 2012",
    consentRequirements: ["data_processing", "background_check"],
  },
  RW: {
    country: "RW",
    countryName: "Rwanda",
    supportedDocuments: ["NATIONAL_ID_RW", "PASSPORT"],
    primaryIdDocument: "NATIONAL_ID_RW",
    requiredForRider: ["NATIONAL_ID_RW"],
    requiredForDriver: ["NATIONAL_ID_RW"],
    backgroundCheckProvider: "rwanda_police",
    verificationProviders: ["nida", "smile_id"],
    emergencyNumber: "112",
    policeNumber: "112",
    dataProtectionLaw: "Law No. 058/2021",
    consentRequirements: ["data_processing"],
  },
  ET: {
    country: "ET",
    countryName: "Ethiopia",
    supportedDocuments: ["NATIONAL_ID_ET", "PASSPORT"],
    primaryIdDocument: "NATIONAL_ID_ET",
    requiredForRider: ["NATIONAL_ID_ET"],
    requiredForDriver: ["NATIONAL_ID_ET"],
    backgroundCheckProvider: "ethiopia_police",
    verificationProviders: ["nid_ethiopia", "smile_id"],
    emergencyNumber: "911",
    policeNumber: "991",
    dataProtectionLaw: "Draft Data Protection Proclamation",
    consentRequirements: ["data_processing"],
  },
};

// =============================================================================
// EVENT TYPES FOR SAFETY SYSTEM
// =============================================================================

export interface SafetyEvent {
  eventType: SafetyEventType;
  userId: string;
  tripId?: string;
  timestamp: Date;
  location?: Location;
  deviceInfo?: DeviceInfo;
  metadata?: Record<string, any>;
}

export type SafetyEventType =
  | "trip_started"
  | "trip_completed"
  | "trip_cancelled"
  | "location_update"
  | "sos_triggered"
  | "sos_cancelled"
  | "crash_detected"
  | "anomaly_detected"
  | "safety_check_sent"
  | "safety_check_responded"
  | "safety_check_timeout"
  | "incident_reported"
  | "verification_submitted"
  | "verification_approved"
  | "verification_rejected"
  | "background_check_completed"
  | "fraud_detected"
  | "account_restricted"
  | "account_suspended";
