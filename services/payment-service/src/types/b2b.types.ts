/**
 * UBI B2B Platform Types & Interfaces
 *
 * Comprehensive type definitions for:
 * - Organizations & Corporate Accounts
 * - Delivery API
 * - E-commerce Integrations
 * - Healthcare & School Transport
 * - API Management
 * - Billing & Invoicing
 */

// =============================================================================
// ENUMS
// =============================================================================

export type OrganizationType =
  | "COMPANY"
  | "SCHOOL"
  | "HOSPITAL"
  | "HEALTHCARE_PROVIDER"
  | "PHARMACY"
  | "ECOMMERCE"
  | "LOGISTICS"
  | "GOVERNMENT"
  | "NGO"
  | "OTHER";

export type OrganizationSize =
  | "STARTUP"
  | "SMALL"
  | "MEDIUM"
  | "LARGE"
  | "ENTERPRISE";

export type OrganizationStatus =
  | "PENDING_VERIFICATION"
  | "ACTIVE"
  | "SUSPENDED"
  | "INACTIVE"
  | "CLOSED";

export type MemberRole =
  | "OWNER"
  | "ADMIN"
  | "FINANCE_ADMIN"
  | "MANAGER"
  | "DISPATCHER"
  | "MEMBER"
  | "VIEWER";

export type MemberStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type DeliveryStatus =
  | "PENDING"
  | "QUOTED"
  | "CONFIRMED"
  | "DRIVER_ASSIGNED"
  | "PICKUP_EN_ROUTE"
  | "AT_PICKUP"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "AT_DROPOFF"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED"
  | "RETURNED";

export type DeliveryPriority =
  | "ECONOMY"
  | "STANDARD"
  | "EXPRESS"
  | "SAME_DAY"
  | "INSTANT"
  | "SCHEDULED";

export type PackageSize =
  | "ENVELOPE"
  | "SMALL"
  | "MEDIUM"
  | "LARGE"
  | "XLARGE"
  | "CUSTOM";

export type ProofOfDeliveryType =
  | "NONE"
  | "PHOTO"
  | "SIGNATURE"
  | "OTP"
  | "PHOTO_SIGNATURE"
  | "PHOTO_OTP"
  | "BARCODE_SCAN";

export type WebhookEvent =
  | "delivery.created"
  | "delivery.quoted"
  | "delivery.confirmed"
  | "delivery.driver_assigned"
  | "delivery.pickup_en_route"
  | "delivery.picked_up"
  | "delivery.in_transit"
  | "delivery.delivered"
  | "delivery.failed"
  | "delivery.cancelled"
  | "trip.created"
  | "trip.driver_assigned"
  | "trip.started"
  | "trip.completed"
  | "trip.cancelled"
  | "invoice.created"
  | "invoice.paid"
  | "payment.failed";

export type ApiKeyEnvironment = "SANDBOX" | "PRODUCTION";

export type ApiKeyScope =
  | "organizations:read"
  | "organizations:write"
  | "deliveries:read"
  | "deliveries:write"
  | "healthcare:read"
  | "healthcare:write"
  | "school:read"
  | "school:write"
  | "billing:read"
  | "billing:write"
  | "webhooks:read"
  | "webhooks:write"
  | "api_keys:read"
  | "api_keys:write";

export type InvoiceStatus =
  | "DRAFT"
  | "PENDING"
  | "SENT"
  | "PAID"
  | "PARTIALLY_PAID"
  | "OVERDUE"
  | "CANCELLED"
  | "REFUNDED";

export type UsageType =
  | "ride"
  | "delivery"
  | "api_call"
  | "school_transport"
  | "medical_transport"
  | "subscription"
  | "platform_fee"
  | "other";

export type BillingCycle =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "ANNUAL"
  | "PAY_AS_YOU_GO";

export type IntegrationType =
  | "SHOPIFY"
  | "WOOCOMMERCE"
  | "MAGENTO"
  | "JUMIA"
  | "TAKEALOT"
  | "KONGA"
  | "CUSTOM_API"
  | "ERP_SAP"
  | "ERP_ORACLE"
  | "HR_WORKDAY"
  | "HR_BAMBOO";

export type SchoolRouteType =
  | "MORNING_PICKUP"
  | "AFTERNOON_DROPOFF"
  | "FIELD_TRIP"
  | "SPECIAL_EVENT";

export type MedicalTransportType =
  | "PRESCRIPTION_DELIVERY"
  | "LAB_SAMPLE_PICKUP"
  | "PATIENT_TRANSPORT"
  | "MEDICAL_EQUIPMENT"
  | "ORGAN_TRANSPORT"
  | "EMERGENCY_SUPPLY";

export type VehicleRequirement =
  | "STANDARD"
  | "WHEELCHAIR_ACCESSIBLE"
  | "STRETCHER_CAPABLE"
  | "COLD_CHAIN"
  | "TEMPERATURE_CONTROLLED"
  | "BIOHAZARD_CERTIFIED";

// =============================================================================
// COMMON TYPES
// =============================================================================

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  coordinates?: Coordinates;
}

export interface ContactInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    nextCursor?: string;
  };
}

// =============================================================================
// ORGANIZATION TYPES
// =============================================================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName?: string;
  type: OrganizationType;
  industry?: string;
  size: OrganizationSize;
  registrationNumber?: string;
  taxId?: string;
  vatNumber?: string;
  email: string;
  billingEmail?: string;
  phone?: string;
  website?: string;
  country: string;
  address?: Address;
  logoUrl?: string;
  primaryColor?: string;
  settings: OrganizationSettings;
  status: OrganizationStatus;
  verifiedAt?: Date;
  billingCycle: BillingCycle;
  creditLimit: number;
  currentBalance: number;
  paymentTermDays: number;
  contractStartDate?: Date;
  contractEndDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSettings {
  timezone: string;
  currency: string;
  language: string;
  autoApprove: boolean;
  maxSpendPerTrip?: number;
  allowedVehicleTypes: string[];
  requireProjectCode: boolean;
  ssoEnabled: boolean;
  ssoProvider?: string;
  ssoDomain?: string;
  defaultCostCenterId?: string;
  notificationPreferences: NotificationPreferences;
}

export interface NotificationPreferences {
  tripConfirmation: boolean;
  tripCompletion: boolean;
  deliveryUpdates: boolean;
  invoiceGenerated: boolean;
  paymentReminder: boolean;
  budgetAlerts: boolean;
}

export interface CreateOrganizationRequest {
  name: string;
  legalName?: string;
  type: OrganizationType;
  industry?: string;
  size?: OrganizationSize;
  registrationNumber?: string;
  taxId?: string;
  email: string;
  billingEmail?: string;
  phone?: string;
  website?: string;
  country: string;
  address?: Address;
}

export interface UpdateOrganizationRequest {
  name?: string;
  legalName?: string;
  industry?: string;
  size?: OrganizationSize;
  billingEmail?: string;
  phone?: string;
  website?: string;
  address?: Address;
  settings?: Partial<OrganizationSettings>;
}

// =============================================================================
// MEMBER TYPES
// =============================================================================

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId?: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: MemberRole;
  permissions: MemberPermission[];
  departmentId?: string;
  departmentName?: string;
  employeeId?: string;
  title?: string;
  managerId?: string;
  spendingLimitPerTrip?: number;
  monthlyLimit?: number;
  requiresApproval: boolean;
  defaultCostCenterId?: string;
  status: MemberStatus;
  invitedBy?: string;
  invitedAt: Date;
  joinedAt?: Date;
  lastActiveAt?: Date;
}

export type MemberPermission =
  | "trips:create"
  | "trips:view"
  | "trips:view_all"
  | "trips:approve"
  | "trips:cancel"
  | "deliveries:create"
  | "deliveries:view"
  | "deliveries:view_all"
  | "deliveries:cancel"
  | "members:invite"
  | "members:manage"
  | "members:remove"
  | "reports:view"
  | "reports:export"
  | "billing:view"
  | "billing:manage"
  | "settings:view"
  | "settings:manage"
  | "api:manage"
  | "integrations:manage";

export interface InviteMemberRequest {
  email: string;
  firstName: string;
  lastName: string;
  role: MemberRole;
  departmentId?: string;
  employeeId?: string;
  title?: string;
  managerId?: string;
  spendingLimitPerTrip?: number;
  monthlyLimit?: number;
  requiresApproval?: boolean;
}

export interface UpdateMemberRequest {
  role?: MemberRole;
  departmentId?: string;
  title?: string;
  managerId?: string;
  spendingLimitPerTrip?: number;
  monthlyLimit?: number;
  requiresApproval?: boolean;
  permissions?: MemberPermission[];
}

// =============================================================================
// COST CENTER & DEPARTMENT TYPES
// =============================================================================

export interface CostCenter {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  parentId?: string;
  budget?: number;
  budgetPeriod?: "monthly" | "quarterly" | "annual";
  budgetUsed: number;
  budgetAlertThreshold?: number;
  isActive: boolean;
  children?: CostCenter[];
}

export interface CreateCostCenterRequest {
  name: string;
  code: string;
  description?: string;
  parentId?: string;
  budget?: number;
  budgetPeriod?: "monthly" | "quarterly" | "annual";
  budgetAlertThreshold?: number;
}

export interface Department {
  id: string;
  organizationId: string;
  name: string;
  code?: string;
  headId?: string;
  parentId?: string;
  isActive: boolean;
  memberCount?: number;
  children?: Department[];
}

// =============================================================================
// APPROVAL TYPES
// =============================================================================

export interface ApprovalPolicy {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  priority: number;
  conditions: ApprovalCondition[];
  requiresApproval: boolean;
  approverRoles: MemberRole[];
  approverMemberIds: string[];
  autoApproveAfter?: number;
  actions: ApprovalAction[];
  isActive: boolean;
}

export interface ApprovalCondition {
  field: string;
  operator:
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "in"
    | "nin"
    | "between";
  value: any;
}

export interface ApprovalAction {
  type: "notify" | "flag" | "block" | "require_note";
  recipients?: string[];
  reason?: string;
  message?: string;
}

export interface ApprovalRequest {
  id: string;
  organizationId: string;
  entityType: "trip" | "delivery" | "expense";
  entityId: string;
  requesterId: string;
  requesterName: string;
  amount: number;
  reason?: string;
  metadata: Record<string, any>;
  status: ApprovalStatus;
  approverId?: string;
  approverName?: string;
  approverNotes?: string;
  requestedAt: Date;
  expiresAt?: Date;
  respondedAt?: Date;
}

export interface PolicyCheckResult {
  requiresApproval: boolean;
  matchedPolicy?: ApprovalPolicy;
  actions: ApprovalAction[];
  blockedReason?: string;
}

// =============================================================================
// CORPORATE TRIP TYPES
// =============================================================================

export interface CorporateTrip {
  id: string;
  organizationId: string;
  memberId: string;
  memberName: string;
  bookedById?: string;
  bookedByName?: string;
  tripId?: string;
  pickupAddress: string;
  pickupCoordinates?: Coordinates;
  dropoffAddress: string;
  dropoffCoordinates?: Coordinates;
  scheduledAt?: Date;
  vehicleType: string;
  purpose?: string;
  projectCode?: string;
  notes?: string;
  costCenterId?: string;
  costCenterName?: string;
  estimatedCost?: number;
  actualCost?: number;
  currency: string;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  approvalRequestId?: string;
  status: string;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  receiptUrl?: string;
  createdAt: Date;
}

export interface CreateCorporateTripRequest {
  memberId?: string;
  pickupAddress: string;
  pickupCoordinates?: Coordinates;
  dropoffAddress: string;
  dropoffCoordinates?: Coordinates;
  scheduledAt?: Date;
  vehicleType?: string;
  purpose?: string;
  projectCode?: string;
  notes?: string;
  costCenterId?: string;
}

export interface BookForEmployeeRequest extends CreateCorporateTripRequest {
  employeeMemberId: string;
}

// =============================================================================
// DELIVERY API TYPES
// =============================================================================

export interface Delivery {
  id: string;
  organizationId: string;
  externalId?: string;
  trackingCode: string;
  status: DeliveryStatus;
  priority: DeliveryPriority;
  pickup: DeliveryLocation;
  dropoff: DeliveryLocation;
  recipient: RecipientInfo;
  package: PackageInfo;
  schedule?: DeliverySchedule;
  options: DeliveryOptions;
  pricing: DeliveryPricing;
  driver?: DriverInfo;
  timestamps: DeliveryTimestamps;
  proofOfDelivery?: ProofOfDelivery;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryLocation {
  address: string;
  coordinates?: Coordinates;
  plusCode?: string;
  contactName?: string;
  contactPhone?: string;
  instructions?: string;
}

export interface RecipientInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface PackageInfo {
  size: PackageSize;
  weightKg?: number;
  dimensions?: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  description?: string;
  value?: number;
  isFragile: boolean;
  requiresSignature: boolean;
}

export interface DeliverySchedule {
  pickupTime?: Date;
  pickupWindowStart?: Date;
  pickupWindowEnd?: Date;
  dropoffTime?: Date;
  dropoffWindowStart?: Date;
  dropoffWindowEnd?: Date;
}

export interface DeliveryOptions {
  priority: DeliveryPriority;
  cashOnDelivery?: number;
  proofOfDeliveryType: ProofOfDeliveryType;
  insurance: boolean;
  insuranceAmount?: number;
  ageVerification?: number;
  temperatureControl?: {
    required: boolean;
    minTemp?: number;
    maxTemp?: number;
  };
}

export interface DeliveryPricing {
  quotedPrice?: number;
  finalPrice?: number;
  currency: string;
  distanceKm?: number;
  estimatedDurationMins?: number;
  breakdown?: {
    basePrice: number;
    distancePrice: number;
    priorityFee: number;
    insuranceFee: number;
    codFee: number;
    tax: number;
  };
}

export interface DriverInfo {
  id: string;
  name: string;
  phone: string;
  photoUrl?: string;
  vehicleType: string;
  vehiclePlate: string;
  rating?: number;
  location?: Coordinates;
}

export interface DeliveryTimestamps {
  quotedAt?: Date;
  confirmedAt?: Date;
  driverAssignedAt?: Date;
  pickupEnRouteAt?: Date;
  atPickupAt?: Date;
  pickedUpAt?: Date;
  inTransitAt?: Date;
  atDropoffAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  returnedAt?: Date;
}

export interface ProofOfDelivery {
  type: ProofOfDeliveryType;
  photoUrl?: string;
  signatureUrl?: string;
  otpVerified?: boolean;
  verifiedAt?: Date;
  recipientName?: string;
}

// API Request/Response Types
export interface CreateDeliveryRequest {
  external_id?: string;
  pickup: {
    address: string;
    latitude?: number;
    longitude?: number;
    plus_code?: string;
    contact_name?: string;
    contact_phone?: string;
    instructions?: string;
  };
  dropoff: {
    address: string;
    latitude?: number;
    longitude?: number;
    plus_code?: string;
    contact_name: string;
    contact_phone: string;
    instructions?: string;
  };
  recipient?: {
    name: string;
    phone: string;
    email?: string;
  };
  package: {
    size?: PackageSize;
    weight_kg?: number;
    description?: string;
    value?: number;
    fragile?: boolean;
    requires_signature?: boolean;
  };
  schedule?: {
    pickup_time?: string;
    pickup_window_start?: string;
    pickup_window_end?: string;
    dropoff_time?: string;
    dropoff_window_start?: string;
    dropoff_window_end?: string;
  };
  options?: {
    priority?: DeliveryPriority;
    cash_on_delivery?: number;
    proof_of_delivery?: ProofOfDeliveryType;
    insurance?: boolean;
    insurance_amount?: number;
    age_verification?: number;
  };
  cost_center_id?: string;
  metadata?: Record<string, any>;
}

export interface DeliveryQuoteRequest {
  pickup: {
    address: string;
    latitude?: number;
    longitude?: number;
  };
  dropoff: {
    address: string;
    latitude?: number;
    longitude?: number;
  };
  package: {
    size?: PackageSize;
    weight_kg?: number;
  };
  priority?: DeliveryPriority;
}

export interface DeliveryQuote {
  id: string;
  price: number;
  currency: string;
  distanceKm: number;
  estimatedDurationMins: number;
  priority: DeliveryPriority;
  breakdown: {
    basePrice: number;
    distancePrice: number;
    priorityFee: number;
    insuranceFee: number;
    tax: number;
  };
  validUntil: Date;
}

export interface BatchDeliveryRequest {
  deliveries: CreateDeliveryRequest[];
}

export interface BatchDeliveryResult {
  total: number;
  successful: number;
  failed: number;
  results: {
    index: number;
    success: boolean;
    delivery?: Delivery;
    error?: string;
  }[];
}

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

export interface Webhook {
  id: string;
  organizationId: string;
  url: string;
  description?: string;
  events: WebhookEvent[];
  status: "ACTIVE" | "PAUSED" | "FAILED" | "DISABLED";
  maxRetries: number;
  lastTriggeredAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  consecutiveFailures: number;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateWebhookRequest {
  url: string;
  description?: string;
  events: WebhookEvent[];
}

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  data: any;
  timestamp: string;
  organization_id: string;
}

export interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  event: string;
  payload: any;
  attemptNumber: number;
  statusCode?: number;
  responseBody?: string;
  responseTimeMs?: number;
  success: boolean;
  errorMessage?: string;
  createdAt: Date;
}

// =============================================================================
// API KEY TYPES
// =============================================================================

export interface ApiKey {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  keyPrefix: string;
  lastFourChars: string;
  environment: ApiKeyEnvironment;
  permissions: string[];
  rateLimitPerMinute: number;
  rateLimitPerDay?: number;
  ipWhitelist: string[];
  allowedOrigins: string[];
  totalRequests: number;
  lastUsedAt?: Date;
  lastUsedIp?: string;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  environment: ApiKeyEnvironment;
  permissions?: string[];
  rateLimitPerMinute?: number;
  rateLimitPerDay?: number;
  ipWhitelist?: string[];
  allowedOrigins?: string[];
  expiresAt?: Date;
}

export interface ApiKeyWithSecret extends ApiKey {
  key: string; // Only returned once on creation
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface ApiRequest {
  id: string;
  organizationId: string;
  apiKeyId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  statusCode: number;
  latencyMs: number;
  clientIp: string;
  userAgent?: string;
  requestBody?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  errorMessage?: string;
  timestamp: Date;
}

// =============================================================================
// INTEGRATION TYPES
// =============================================================================

export interface Integration {
  id: string;
  organizationId: string;
  type: IntegrationType;
  name: string;
  externalShopId?: string;
  externalAccountId?: string;
  settings: IntegrationSettings;
  status: "PENDING_SETUP" | "ACTIVE" | "PAUSED" | "ERROR" | "DISCONNECTED";
  lastSyncAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
  ordersProcessed: number;
  deliveriesCreated: number;
  isActive: boolean;
  createdAt: Date;
}

export interface IntegrationSettings {
  autoDispatch: boolean;
  defaultPriority: DeliveryPriority;
  proofOfDelivery: ProofOfDeliveryType;
  syncInventory: boolean;
  fulfillmentLocations: string[];
  orderFilters?: {
    minOrderValue?: number;
    excludeTags?: string[];
    includeTags?: string[];
  };
}

export interface ShopifyOrder {
  id: string;
  order_number: string;
  email: string;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string;
  shipping_address: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    province?: string;
    zip: string;
    country: string;
    phone?: string;
  };
  line_items: {
    id: string;
    title: string;
    quantity: number;
    price: string;
    grams: number;
  }[];
  payment_gateway_names: string[];
}

// =============================================================================
// SCHOOL TRANSPORT TYPES
// =============================================================================

export interface School {
  id: string;
  organizationId: string;
  schoolType: "primary" | "secondary" | "mixed";
  studentCount?: number;
  address: string;
  coordinates: Coordinates;
  gateLocations: Coordinates[];
  startTime: string;
  endTime: string;
  timezone: string;
  operatingDays: number[];
  settings: SchoolSettings;
}

export interface SchoolSettings {
  requirePhotoVerification: boolean;
  allowThirdPartyPickup: boolean;
  maxPickupRadius: number;
  parentNotifications: boolean;
  absenteeNotifications: boolean;
}

export interface Student {
  id: string;
  schoolId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  grade?: string;
  className?: string;
  photoUrl?: string;
  homeAddress: string;
  homeCoordinates: Coordinates;
  pickupPointAddress?: string;
  pickupPointCoordinates?: Coordinates;
  pickupPointNotes?: string;
  guardians: Guardian[];
  specialNeeds?: string;
  medicalNotes?: string;
  subscriptionStatus: "active" | "paused" | "cancelled";
  subscriptionType: "morning" | "afternoon" | "both";
  isActive: boolean;
}

export interface Guardian {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  userId?: string;
  isPrimary: boolean;
  canPickup: boolean;
  photoUrl?: string;
}

export interface SchoolRoute {
  id: string;
  schoolId: string;
  name: string;
  type: SchoolRouteType;
  stops: RouteStop[];
  estimatedDurationMins?: number;
  startTime?: string;
  assignedDriverId?: string;
  assignedVehicleId?: string;
  driverName?: string;
  driverPhone?: string;
  vehiclePlate?: string;
  vehicleCapacity?: number;
  studentCount: number;
  isActive: boolean;
}

export interface RouteStop {
  order: number;
  address: string;
  coordinates: Coordinates;
  estimatedTime: string;
  waitTimeMinutes: number;
  studentIds: string[];
}

export interface ActiveSchoolRoute {
  id: string;
  routeId: string;
  routeName: string;
  date: Date;
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehiclePlate: string;
  status: "not_started" | "in_progress" | "completed" | "cancelled";
  currentStopIndex: number;
  currentLocation?: Coordinates;
  startedAt?: Date;
  completedAt?: Date;
  studentsExpected: number;
  studentsPickedUp: number;
  studentsDroppedOff: number;
  studentsAbsent: number;
  estimatedArrival?: Date;
}

export interface StudentTripLog {
  id: string;
  activeRouteId: string;
  studentId: string;
  studentName: string;
  eventType: "pickup" | "dropoff" | "absent";
  location?: Coordinates;
  timestamp: Date;
  verifiedBy?: string;
  verificationMethod?: "app" | "manual" | "photo";
  photoUrl?: string;
  notes?: string;
  guardianNotifiedAt?: Date;
}

export interface StudentLocation {
  status: "not_in_transit" | "waiting_pickup" | "picked_up" | "dropped_off";
  vehicleLocation?: Coordinates;
  estimatedArrival?: Date;
  driverName?: string;
  driverPhone?: string;
  vehiclePlate?: string;
  lastUpdated?: Date;
}

// =============================================================================
// HEALTHCARE TRANSPORT TYPES
// =============================================================================

export interface HealthcareProvider {
  id: string;
  organizationId: string;
  providerType: "hospital" | "clinic" | "pharmacy" | "lab" | "home_care";
  licenseNumber?: string;
  licenseExpiry?: Date;
  certifications: string[];
  operatingHours: Record<string, { open: string; close: string }>;
  emergencyContact?: ContactInfo;
  settings: Record<string, any>;
}

export interface MedicalDelivery {
  id: string;
  providerId: string;
  deliveryType: MedicalTransportType;
  externalReference?: string;
  pickupAddress: string;
  pickupCoordinates?: Coordinates;
  pickupContact: ContactInfo;
  deliveryAddress: string;
  deliveryCoordinates?: Coordinates;
  deliveryContact: ContactInfo;
  patientReference?: string;
  packageDescription: string;
  isControlledSubstance: boolean;
  requiresColdChain: boolean;
  temperatureRange?: { min: number; max: number };
  isUrgent: boolean;
  requiresIdVerification: boolean;
  requiresAgeVerification: boolean;
  minimumAge?: number;
  requiresSignature: boolean;
  vehicleRequirement: VehicleRequirement;
  handlingInstructions?: string;
  status: DeliveryStatus;
  driverId?: string;
  assignedAt?: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
  pickupVerification?: any;
  deliveryVerification?: any;
  temperatureLog: { timestamp: Date; temperature: number }[];
  price?: number;
  currency: string;
  deliveryId?: string;
  createdAt: Date;
}

export interface CreateMedicalDeliveryRequest {
  deliveryType: MedicalTransportType;
  externalReference?: string;
  pickupContact: ContactInfo;
  deliveryAddress: string;
  deliveryCoordinates?: Coordinates;
  deliveryContact: ContactInfo;
  patientReference?: string;
  packageDescription: string;
  isControlledSubstance?: boolean;
  requiresColdChain?: boolean;
  temperatureRange?: { min: number; max: number };
  isUrgent?: boolean;
  requiresIdVerification?: boolean;
  requiresAgeVerification?: boolean;
  minimumAge?: number;
  vehicleRequirement?: VehicleRequirement;
  handlingInstructions?: string;
}

export interface PatientTransport {
  id: string;
  providerId: string;
  bookingReference: string;
  patientReference: string;
  patientFirstName: string;
  patientPhone?: string;
  wheelchairAccessible: boolean;
  stretcherRequired: boolean;
  oxygenRequired: boolean;
  accompanyingPersons: number;
  medicalEquipment: string[];
  pickupAddress: string;
  pickupCoordinates?: Coordinates;
  pickupInstructions?: string;
  destinationAddress: string;
  destinationCoordinates?: Coordinates;
  destinationType: string;
  appointmentTime: Date;
  pickupTime: Date;
  returnTripRequired: boolean;
  estimatedReturnTime?: Date;
  status: string;
  driverId?: string;
  vehicleId?: string;
  assignedAt?: Date;
  pickedUpAt?: Date;
  arrivedAt?: Date;
  completedAt?: Date;
  tripId?: string;
  returnTripId?: string;
  medicalNotes?: string;
  driverNotes?: string;
  price?: number;
  currency: string;
  createdAt: Date;
}

export interface CreatePatientTransportRequest {
  patientReference: string;
  patientFirstName: string;
  patientPhone?: string;
  wheelchairAccessible?: boolean;
  stretcherRequired?: boolean;
  oxygenRequired?: boolean;
  accompanyingPersons?: number;
  medicalEquipment?: string[];
  pickupAddress: string;
  pickupCoordinates?: Coordinates;
  pickupInstructions?: string;
  destinationAddress: string;
  destinationCoordinates?: Coordinates;
  destinationType: string;
  appointmentTime: Date;
  returnTripRequired?: boolean;
  estimatedReturnTime?: Date;
  medicalNotes?: string;
}

// =============================================================================
// BILLING TYPES
// =============================================================================

export interface Invoice {
  id: string;
  organizationId: string;
  invoiceNumber: string;
  periodStart: Date;
  periodEnd: Date;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  discountReason?: string;
  creditApplied: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt?: Date;
  dueDate?: Date;
  paidAt?: Date;
  pdfUrl?: string;
  notes?: string;
  createdAt: Date;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  details?: Record<string, any>;
}

export interface UsageRecord {
  id: string;
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  usageType: "ride" | "delivery" | "api_call" | "sms" | "storage";
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  details: Record<string, any>;
  invoiced: boolean;
  invoiceId?: string;
}

export interface UsageSummary {
  period: DateRange;
  rides: {
    count: number;
    totalCost: number;
    averageCost: number;
  };
  deliveries: {
    count: number;
    totalCost: number;
    averageCost: number;
  };
  apiCalls: number;
  totalSpend: number;
  currency: string;
}

export interface Credit {
  id: string;
  organizationId: string;
  type: "prepaid" | "promotional" | "adjustment" | "refund";
  originalAmount: number;
  remainingAmount: number;
  currency: string;
  expiresAt?: Date;
  reason?: string;
  referenceId?: string;
  status: "active" | "depleted" | "expired" | "cancelled";
  issuedBy?: string;
  createdAt: Date;
}

export interface Pricing {
  id: string;
  organizationId: string;
  rideBaseRate?: number;
  ridePerKmRate?: number;
  ridePerMinuteRate?: number;
  deliveryBaseRate?: number;
  deliveryPerKmRate?: number;
  volumeDiscounts: {
    minTrips: number;
    discountPercent: number;
  }[];
  monthlyPlatformFee?: number;
  includedApiCalls: number;
  apiOverageRate?: number;
  effectiveFrom: Date;
  effectiveUntil?: Date;
}

export interface PricingTier {
  id?: string;
  usageType: UsageType;
  unitPrice: number;
  minQuantity?: number;
  maxQuantity?: number;
  description?: string;
}

export interface CreditBalance {
  organizationId: string;
  balance: number;
  currency: string;
  updatedAt: Date;
}

export interface CreditTransaction {
  id: string;
  organizationId: string;
  type: "credit" | "debit";
  amount: number;
  balance: number;
  description: string;
  expiresAt?: Date;
  referenceId?: string;
  createdAt: Date;
}

// =============================================================================
// REPORTING TYPES
// =============================================================================

export interface SpendingReport {
  period: DateRange;
  totalSpend: number;
  tripCount: number;
  deliveryCount: number;
  averageTripCost: number;
  averageDeliveryCost: number;
  byDepartment: {
    departmentId: string;
    name: string;
    amount: number;
    count: number;
  }[];
  byCostCenter: {
    costCenterId: string;
    name: string;
    amount: number;
    count: number;
  }[];
  byEmployee: {
    memberId: string;
    name: string;
    amount: number;
    count: number;
  }[];
  byTripType: { type: string; amount: number; count: number }[];
  byDay: { date: string; amount: number; count: number }[];
  savingsVsRetail: number;
  carbonOffset: number;
  currency: string;
}

export interface EmployeeUsage {
  memberId: string;
  name: string;
  email: string;
  department?: string;
  tripCount: number;
  deliveryCount: number;
  totalSpend: number;
  averagePerTrip: number;
  lastTripDate?: Date;
}

// =============================================================================
// SDK TYPES (for external developers)
// =============================================================================

export interface UbiClientConfig {
  apiKey: string;
  environment?: "sandbox" | "production";
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export interface UbiApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  requestId: string;
}
