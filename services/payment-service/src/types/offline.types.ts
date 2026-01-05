// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - TYPE DEFINITIONS
// =============================================================================
// TypeScript interfaces for offline-first, multi-channel access
// =============================================================================

// =============================================================================
// ENUMS
// =============================================================================

export enum ChannelType {
  APP = "app",
  APP_LITE = "app_lite",
  USSD = "ussd",
  SMS = "sms",
  VOICE = "voice",
  WEB = "web",
  WHATSAPP = "whatsapp",
}

export enum NetworkType {
  OFFLINE = "offline",
  TWO_G = "2g",
  THREE_G = "3g",
  FOUR_G = "4g",
  FIVE_G = "5g",
  WIFI = "wifi",
  UNKNOWN = "unknown",
}

export enum SyncStatus {
  SYNCED = "synced",
  PENDING = "pending",
  SYNCING = "syncing",
  CONFLICT = "conflict",
  FAILED = "failed",
}

export enum ConflictResolution {
  LOCAL_WINS = "local_wins",
  SERVER_WINS = "server_wins",
  MERGED = "merged",
  MANUAL = "manual",
}

export enum USSDState {
  MAIN_MENU = "MAIN_MENU",
  BOOK_RIDE = "BOOK_RIDE",
  BOOK_RIDE_METHOD = "BOOK_RIDE_METHOD",
  ENTER_PICKUP = "ENTER_PICKUP",
  ENTER_DESTINATION = "ENTER_DESTINATION",
  SELECT_VEHICLE = "SELECT_VEHICLE",
  CONFIRM_BOOKING = "CONFIRM_BOOKING",
  TRACK_RIDE = "TRACK_RIDE",
  WALLET_MENU = "WALLET_MENU",
  WALLET_TOPUP = "WALLET_TOPUP",
  WALLET_SEND = "WALLET_SEND",
  WALLET_HISTORY = "WALLET_HISTORY",
  RECENT_TRIPS = "RECENT_TRIPS",
  SAVED_PLACES = "SAVED_PLACES",
  SETTINGS = "SETTINGS",
  LANGUAGE_SELECT = "LANGUAGE_SELECT",
  HELP = "HELP",
  ENTER_PIN = "ENTER_PIN",
  CONFIRM_PIN = "CONFIRM_PIN",
  ERROR = "ERROR",
}

export enum SMSCommand {
  BOOK = "BOOK",
  TRACK = "TRACK",
  CANCEL = "CANCEL",
  BALANCE = "BALANCE",
  HELP = "HELP",
  HOME = "HOME",
  WORK = "WORK",
  RATE = "RATE",
  HISTORY = "HISTORY",
  PROMO = "PROMO",
  STOP = "STOP",
}

export enum IVRState {
  WELCOME = "WELCOME",
  LANGUAGE_SELECT = "LANGUAGE_SELECT",
  MAIN_MENU = "MAIN_MENU",
  BOOK_RIDE = "BOOK_RIDE",
  SPEAK_DESTINATION = "SPEAK_DESTINATION",
  CONFIRM_BOOKING = "CONFIRM_BOOKING",
  TRACK_RIDE = "TRACK_RIDE",
  WALLET_BALANCE = "WALLET_BALANCE",
  TRANSFER_AGENT = "TRANSFER_AGENT",
  HELP = "HELP",
  GOODBYE = "GOODBYE",
}

export enum AgentStatus {
  ONLINE = "online",
  BUSY = "busy",
  BREAK = "break",
  OFFLINE = "offline",
}

export enum ColorBlindMode {
  PROTANOPIA = "protanopia", // Red-blind
  DEUTERANOPIA = "deuteranopia", // Green-blind
  TRITANOPIA = "tritanopia", // Blue-blind
  ACHROMATOPSIA = "achromatopsia", // Complete color blindness
}

export enum WCAGLevel {
  A = "A",
  AA = "AA",
  AAA = "AAA",
}

export enum MessagePriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  URGENT = "urgent",
}

// =============================================================================
// OFFLINE SYNC TYPES
// =============================================================================

export interface SyncState {
  userId: string;
  deviceId: string;
  lastSyncTimestamp: Date;
  lastSyncVersion: bigint;
  syncStatus: SyncStatus;
  pendingChanges: number;
  bandwidth: NetworkType;
}

export interface SyncLog {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  data?: Record<string, unknown>;
  version: bigint;
  timestamp: Date;
}

export interface OfflineAction {
  id: string;
  userId: string;
  deviceId: string;
  actionType: string;
  payload: Record<string, unknown>;
  priority: number;
  status: "pending" | "processing" | "completed" | "failed";
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  processedAt?: Date;
  createdAt: Date;
}

export interface SyncConflict {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  localVersion: Record<string, unknown>;
  serverVersion: Record<string, unknown>;
  resolvedVersion?: Record<string, unknown>;
  resolution?: ConflictResolution;
  resolvedBy?: string;
  status: "pending" | "resolved" | "escalated";
  createdAt: Date;
  resolvedAt?: Date;
}

export interface DeltaSyncRequest {
  userId: string;
  deviceId: string;
  lastSyncTimestamp: number;
  lastSyncVersion: bigint;
  entityTypes?: string[];
}

export interface DeltaSyncResponse {
  changes: Array<{
    entity: string;
    id: string;
    action: "create" | "update" | "delete";
    data?: Record<string, unknown>;
    version: bigint;
  }>;
  currentVersion: bigint;
  timestamp: number;
  hasMore: boolean;
}

// =============================================================================
// USSD TYPES
// =============================================================================

export interface USSDRequest {
  sessionId: string;
  phoneNumber: string;
  serviceCode: string;
  input: string;
  carrier?: string;
  networkCode?: string;
}

export interface USSDResponse {
  message: string;
  continueSession: boolean;
  encoding?: "gsm7" | "ucs2"; // GSM-7 for ASCII, UCS-2 for Unicode
}

export interface USSDSession {
  id: string;
  sessionId: string;
  phoneNumber: string;
  userId?: string;
  serviceCode: string;
  carrier: string;
  state: USSDState;
  menuPath: string[];
  bookingData?: USSDBookingData;
  walletData?: USSDWalletData;
  tempData?: Record<string, unknown>;
  language: string;
  inputHistory: string[];
  lastInput?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface USSDBookingData {
  pickup?: GeoLocation;
  pickupAddress?: string;
  dropoff?: GeoLocation;
  dropoffAddress?: string;
  vehicleType?: string;
  fareEstimate?: number;
  eta?: number;
  tripId?: string;
}

export interface USSDWalletData {
  balance?: number;
  recipientPhone?: string;
  amount?: number;
  transactionType?: string;
}

export interface USSDMenuOption {
  key: string;
  label: Record<string, string>; // Multilingual labels
  action?: string;
  nextMenu?: string;
  handler?: string;
  requiresAuth?: boolean;
}

export interface USSDMenu {
  menuCode: string;
  parentMenu?: string;
  title: Record<string, string>;
  options: USSDMenuOption[];
  inputType?: "text" | "number" | "phone" | "pin";
  inputPrompt?: Record<string, string>;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    message?: Record<string, string>;
  };
  handler?: string;
}

// =============================================================================
// SMS TYPES
// =============================================================================

export interface IncomingSMS {
  messageId: string;
  from: string;
  to: string;
  message: string;
  carrier?: string;
  receivedAt: Date;
}

export interface OutgoingSMS {
  to: string;
  message: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
  priority?: MessagePriority;
  scheduledAt?: Date;
}

export interface SMSDeliveryReport {
  messageId: string;
  to: string;
  status: "sent" | "delivered" | "failed" | "expired";
  deliveredAt?: Date;
  failedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface ParsedSMSCommand {
  action: SMSCommand;
  pickup?: string;
  destination?: string;
  amount?: number;
  rating?: number;
  promoCode?: string;
  rawText: string;
}

export interface SMSTemplate {
  code: string;
  name: string;
  content: Record<string, string>; // Multilingual
  variables: string[];
  category: string;
  maxLength: number;
}

// =============================================================================
// VOICE / IVR TYPES
// =============================================================================

export interface IVRSession {
  id: string;
  callId: string;
  callerId: string;
  calledNumber: string;
  userId?: string;
  state: IVRState;
  menuPath: string[];
  dtmfInput: string[];
  speechInput: string[];
  language: string;
  bookingData?: USSDBookingData;
  agentId?: string;
  transferredAt?: Date;
  duration?: number;
  recordingUrl?: string;
  status: "in_progress" | "completed" | "abandoned" | "transferred";
  startedAt: Date;
  endedAt?: Date;
}

export interface IVRAction {
  action: "play" | "say" | "gather" | "record" | "dial" | "hangup" | "redirect";
  audio?: string; // Audio file to play
  text?: string; // Text to say (TTS)
  voice?: string; // TTS voice
  language?: string;
  gatherOptions?: {
    numDigits?: number;
    timeout?: number;
    finishOnKey?: string;
    speechTimeout?: number;
    prompt?: string;
  };
  dialOptions?: {
    number?: string;
    timeout?: number;
    callerId?: string;
  };
  nextAction?: string;
}

export interface CallCenterAgent {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  extension?: string;
  languages: string[];
  skills: string[];
  status: AgentStatus;
  currentCalls: number;
  maxCalls: number;
  rating?: number;
}

export interface AgentBookingRequest {
  agentId: string;
  callId?: string;
  userId: string;
  phone: string;
  pickup: GeoLocation;
  pickupAddress: string;
  dropoff: GeoLocation;
  dropoffAddress: string;
  vehicleType?: string;
  paymentMethod?: string;
  notes?: string;
}

// =============================================================================
// ACCESSIBILITY TYPES
// =============================================================================

export interface AccessibilityPreferences {
  userId: string;
  highContrast: boolean;
  largeText: boolean;
  textScale: number;
  largeTargets: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  screenReader: boolean;
  voiceControl: boolean;
  hapticFeedback: boolean;
  soundEffects: boolean;
  colorBlindMode?: ColorBlindMode;
  preferredLanguage: string;
  preferredChannel: ChannelType;
  readAloudSpeed: number;
  simplifiedUI: boolean;
}

export interface AccessibilityAuditResult {
  screenName: string;
  component?: string;
  wcagLevel: WCAGLevel;
  criterion: string;
  criterionName: string;
  status: "pass" | "fail" | "warning" | "not_applicable";
  issue?: string;
  suggestion?: string;
  automated: boolean;
}

export interface VoiceCommand {
  transcript: string;
  confidence: number;
  language: string;
  parsed?: {
    intent: string;
    entities: Record<string, string>;
    action?: string;
  };
}

export interface ScreenReaderAnnouncement {
  message: string;
  priority: "polite" | "assertive";
  language?: string;
}

// =============================================================================
// TRANSLATION TYPES
// =============================================================================

export interface Translation {
  key: string;
  namespace: string;
  language: string;
  value: string;
  pluralForms?: Record<string, string>;
  context?: string;
  isVerified: boolean;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
  fallbackCode?: string;
  pluralRules?: string;
  dateFormat: string;
  timeFormat: string;
  currencyFormat: string;
  numberFormat?: {
    decimal: string;
    thousand: string;
  };
  coverage: number;
  isActive: boolean;
}

export interface TranslationRequest {
  key: string;
  language: string;
  namespace?: string;
  params?: Record<string, string | number>;
  count?: number; // For plural handling
}

// =============================================================================
// LOW BANDWIDTH TYPES
// =============================================================================

export interface CompressedResponse<T = unknown> {
  data: T;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  encoding: "gzip" | "brotli" | "msgpack" | "none";
}

export interface LiteTrip {
  id: string;
  s: string; // status (abbreviated)
  d?: string; // driver first name
  p?: string; // vehicle plate
  e?: number; // eta minutes
  lat?: number; // driver lat
  lng?: number; // driver lng
  f?: number; // fare
}

export interface LiteFareEstimate {
  f: number; // fare (rounded)
  t: number; // time (minutes)
  d: number; // distance (km, 1 decimal)
}

export interface DataUsageStats {
  userId: string;
  period: "day" | "week" | "month";
  totalBytes: number;
  requestCount: number;
  avgLatency: number;
  byEndpoint: Record<string, { bytes: number; count: number }>;
  byNetworkType: Record<string, { bytes: number; count: number }>;
  savedBytes: number; // Bytes saved by compression
}

export interface CachedPlace {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: string;
  city: string;
  searchTerms: string[];
  popularity: number;
}

export interface OfflineMapRegion {
  id: string;
  name: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  centerLat: number;
  centerLng: number;
  minZoom: number;
  maxZoom: number;
  sizeBytes: number;
  version: number;
  downloadUrl: string;
  checksum: string;
}

// =============================================================================
// CHANNEL TYPES
// =============================================================================

export interface ChannelPreference {
  userId: string;
  primaryChannel: ChannelType;
  fallbackChannel?: ChannelType;
  notificationSMS: boolean;
  notificationPush: boolean;
  notificationEmail: boolean;
  notificationVoice: boolean;
  ussdPin?: string;
  smsKeywords: string[];
  preferredTime?: {
    quietStart: string; // HH:mm
    quietEnd: string;
    timezone: string;
  };
}

export interface ChannelAvailability {
  country: string;
  region?: string;
  carrier?: string;
  ussdAvailable: boolean;
  ussdShortcode?: string;
  smsAvailable: boolean;
  smsShortcode?: string;
  voiceAvailable: boolean;
  voiceNumber?: string;
  appLiteAvailable: boolean;
}

// =============================================================================
// COMMON TYPES
// =============================================================================

export interface GeoLocation {
  lat: number;
  lng: number;
}

export interface Carrier {
  code: string;
  name: string;
  country: string;
  mcc: string; // Mobile Country Code
  mnc: string; // Mobile Network Code
  ussdSupported: boolean;
  smsSupported: boolean;
}

// =============================================================================
// SERVICE INTERFACES
// =============================================================================

export interface IOfflineSyncService {
  queueAction(action: Omit<OfflineAction, "id" | "createdAt">): Promise<string>;
  syncPendingActions(userId: string, deviceId: string): Promise<void>;
  getDeltaSync(request: DeltaSyncRequest): Promise<DeltaSyncResponse>;
  resolveConflict(
    conflictId: string,
    resolution: ConflictResolution
  ): Promise<void>;
  getSyncState(userId: string, deviceId: string): Promise<SyncState | null>;
}

export interface IUSSDService {
  handleRequest(request: USSDRequest): Promise<USSDResponse>;
  getSession(sessionId: string): Promise<USSDSession | null>;
  createSession(request: USSDRequest): Promise<USSDSession>;
  updateSession(session: USSDSession): Promise<void>;
  endSession(sessionId: string): Promise<void>;
}

export interface ISMSService {
  handleIncoming(sms: IncomingSMS): Promise<void>;
  send(sms: OutgoingSMS): Promise<string>;
  sendTemplate(
    to: string,
    templateCode: string,
    data: Record<string, unknown>,
    language?: string
  ): Promise<string>;
  parseCommand(message: string): ParsedSMSCommand;
}

export interface IVoiceService {
  handleIncomingCall(callId: string, callerId: string): Promise<IVRAction>;
  processInput(
    callId: string,
    input: string,
    inputType: "dtmf" | "speech"
  ): Promise<IVRAction>;
  transferToAgent(callId: string, skill?: string): Promise<IVRAction>;
  endCall(callId: string): Promise<void>;
}

export interface IAccessibilityService {
  getPreferences(userId: string): Promise<AccessibilityPreferences>;
  updatePreferences(
    userId: string,
    prefs: Partial<AccessibilityPreferences>
  ): Promise<void>;
  parseVoiceCommand(audio: Buffer, language: string): Promise<VoiceCommand>;
  getScreenReaderText(screenName: string, language: string): Promise<string>;
}

export interface ITranslationService {
  translate(request: TranslationRequest): Promise<string>;
  translateBatch(
    requests: TranslationRequest[]
  ): Promise<Record<string, string>>;
  getLanguages(): Promise<Language[]>;
  getNamespace(
    namespace: string,
    language: string
  ): Promise<Record<string, string>>;
}

export interface ILowBandwidthService {
  compressResponse<T>(data: T): Promise<CompressedResponse<T>>;
  getLiteTrip(tripId: string): Promise<LiteTrip>;
  getLiteFareEstimate(
    origin: GeoLocation,
    destination: GeoLocation
  ): Promise<LiteFareEstimate>;
  searchPlacesOffline(query: string, city: string): Promise<CachedPlace[]>;
  getDataUsageStats(
    userId: string,
    period: "day" | "week" | "month"
  ): Promise<DataUsageStats>;
}
