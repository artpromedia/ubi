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
  GPRS = "gprs",
  EDGE_2G = "edge_2g",
  TWO_G = "2g",
  HSPA_3G = "hspa_3g",
  THREE_G = "3g",
  LTE_4G = "lte_4g",
  FOUR_G = "4g",
  FIVE_G = "5g",
  WIFI = "wifi",
  UNKNOWN = "unknown",
}

export enum SyncStatus {
  IDLE = "idle",
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
  PRICE = "PRICE",
  REGISTER = "REGISTER",
  FEEDBACK = "FEEDBACK",
  CONFIRM = "CONFIRM",
  DRIVER = "DRIVER",
  SET_HOME = "SET_HOME",
  SET_WORK = "SET_WORK",
  UNKNOWN = "UNKNOWN",
}

export enum IVRState {
  WELCOME = "WELCOME",
  LANGUAGE_SELECT = "LANGUAGE_SELECT",
  MAIN_MENU = "MAIN_MENU",
  BOOK_RIDE = "BOOK_RIDE",
  ENTER_PICKUP = "ENTER_PICKUP",
  ENTER_DESTINATION = "ENTER_DESTINATION",
  SPEAK_DESTINATION = "SPEAK_DESTINATION",
  CONFIRM_BOOKING = "CONFIRM_BOOKING",
  BOOKING_CONFIRMED = "BOOKING_CONFIRMED",
  TRACK_RIDE = "TRACK_RIDE",
  TRIP_STATUS = "TRIP_STATUS",
  WALLET_BALANCE = "WALLET_BALANCE",
  WALLET_MENU = "WALLET_MENU",
  TRANSFER_AGENT = "TRANSFER_AGENT",
  AWAITING_AGENT = "AWAITING_AGENT",
  WITH_AGENT = "WITH_AGENT",
  HELP = "HELP",
  GOODBYE = "GOODBYE",
  ENDED = "ENDED",
}

export enum IVRActionType {
  PLAY = "play",
  SPEAK = "speak",
  GATHER = "gather",
  RECORD = "record",
  TRANSFER = "transfer",
  DIAL = "dial",
  HANGUP = "hangup",
  REDIRECT = "redirect",
}

export enum AgentStatus {
  AVAILABLE = "available",
  ONLINE = "online",
  BUSY = "busy",
  BREAK = "break",
  OFFLINE = "offline",
}

export enum ColorBlindMode {
  NONE = "none",
  PROTANOPIA = "protanopia", // Red-blind
  DEUTERANOPIA = "deuteranopia", // Green-blind
  TRITANOPIA = "tritanopia", // Blue-blind
  MONOCHROMACY = "monochromacy", // Complete color blindness
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
  lastSyncAt: Date;
  serverVersion: number;
  clientVersion: number;
  syncStatus: SyncStatus;
  pendingChanges: number;
  syncErrors: number;
  bandwidth?: NetworkType;
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
  entities?: string[];
  networkType?: NetworkType;
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
  serverVersion: number;
  timestamp: number;
  hasMore: boolean;
  syncedAt: Date;
  compressed?: any;
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
  id: string;
  sender: string;
  to: string;
  body: string;
  carrier?: string;
  receivedAt: Date;
}

export interface OutgoingSMS {
  id?: string;
  to?: string;
  recipient?: string;
  sender?: string;
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

export type SMSDeliveryStatus = SMSDeliveryReport["status"];

export interface ParsedSMSCommand {
  command: SMSCommand;
  args: string[];
  raw: string;
}

export interface SMSTemplate {
  id: string;
  code: string;
  name: string;
  template: string;
  language: string;
  content: Record<string, string>; // Multilingual
  variables: string[];
  category: string;
  priority: MessagePriority;
  maxLength: number;
}

// =============================================================================
// VOICE / IVR TYPES
// =============================================================================

export interface IVRSession {
  id: string;
  callSid: string;
  callerPhone: string;
  calledNumber: string;
  userId?: string;
  state: IVRState;
  menuPath: string[];
  inputHistory: string[];
  lastInput?: string;
  retryCount?: number;
  language: string;
  data?: Record<string, unknown>;
  agentId?: string;
  transferredAt?: Date;
  duration?: number;
  recordingUrl?: string;
  status?: "in_progress" | "completed" | "abandoned" | "transferred";
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  endedAt?: Date;
}

export interface IVRAction {
  type: IVRActionType;
  payload?: Record<string, unknown>;
  action?:
    | "play"
    | "say"
    | "gather"
    | "record"
    | "dial"
    | "hangup"
    | "redirect";
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
  currentCallId?: string;
  maxCalls: number;
  rating?: number;
  shiftsThisWeek?: number;
}

export interface AgentBookingRequest {
  agentId: string;
  callId?: string;
  userId: string;
  phone: string;
  userPhone: string;
  pickup: GeoLocation;
  pickupAddress: string;
  dropoff: GeoLocation;
  dropoffAddress: string;
  vehicleType?: string;
  fareEstimate?: number;
  paymentMethod?: string;
  notes?: string;
}

// =============================================================================
// ACCESSIBILITY TYPES
// =============================================================================

export interface AccessibilityPreferences {
  screenReaderEnabled: boolean;
  voiceControlEnabled: boolean;
  fontSize: number;
  highContrast: boolean;
  colorBlindMode: ColorBlindMode;
  reduceMotion: boolean;
  animationDuration?: number;
  reduceTransparency: boolean;
  largerTouchTargets: boolean;
  hapticFeedback: boolean;
  audioDescriptions: boolean;
  captionsEnabled: boolean;
  simplifiedInterface: boolean;
  readingSpeed: number;
  preferredInputMethod: string;
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
  raw: string;
  normalized: string;
  intent: string;
  entities: Record<string, string>;
  confidence: number;
  context?: string;
  language?: string;
}

export interface ScreenReaderAnnouncement {
  text: string;
  priority: "polite" | "assertive";
  language?: string;
  timestamp?: Date;
  role?: string;
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
  compressed?: boolean;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  encoding:
    | "gzip"
    | "brotli"
    | "msgpack"
    | "msgpack+gzip"
    | "identity"
    | "none";
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
  p: number; // price min (rounded)
  x: number; // price max (rounded)
  e: number; // eta in minutes
  d: number; // distance (km, 1 decimal)
  c: string; // currency code
  s?: number; // surge multiplier (if applicable)
}

export interface DataUsageStats {
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  totalBytes: number;
  uploadBytes: number;
  downloadBytes: number;
  byEndpoint: Record<string, number>;
  savedBytes: number; // Bytes saved by compression
  budgetRemaining: number;
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
    resolution: ConflictResolution,
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
    language?: string,
  ): Promise<string>;
  parseCommand(message: string): ParsedSMSCommand;
}

export interface IVoiceService {
  handleIncomingCall(callId: string, callerId: string): Promise<IVRAction>;
  processInput(
    callId: string,
    input: string,
    inputType: "dtmf" | "speech",
  ): Promise<IVRAction>;
  transferToAgent(callId: string, skill?: string): Promise<IVRAction>;
  endCall(callId: string): Promise<void>;
}

export interface IAccessibilityService {
  getPreferences(userId: string): Promise<AccessibilityPreferences>;
  updatePreferences(
    userId: string,
    prefs: Partial<AccessibilityPreferences>,
  ): Promise<void>;
  parseVoiceCommand(transcript: string, context?: string): VoiceCommand;
  getScreenReaderText(screenName: string, language: string): Promise<string>;
}

export interface ITranslationService {
  translate(request: TranslationRequest): Promise<string>;
  translateBatch(
    requests: TranslationRequest[],
  ): Promise<Record<string, string>>;
  getLanguages(): Promise<Language[]>;
  getNamespace(
    namespace: string,
    language: string,
  ): Promise<Record<string, string>>;
}

export interface ILowBandwidthService {
  compressResponse<T>(data: T): Promise<CompressedResponse<T>>;
  getLiteTrip(
    tripId: string,
    networkType?: NetworkType,
  ): Promise<LiteTrip | null>;
  getLiteFareEstimate(
    origin: GeoLocation,
    destination: GeoLocation,
  ): Promise<LiteFareEstimate>;
  searchPlacesOffline(query: string, city: string): Promise<CachedPlace[]>;
  getDataUsageStats(userId: string): Promise<DataUsageStats>;
}
