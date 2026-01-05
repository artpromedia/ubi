/**
 * UBI Healthcare Transport Service (UBI Connect - Healthcare)
 *
 * Specialized medical transport solutions including:
 * - Prescription/medication delivery
 * - Lab sample pickup and delivery
 * - Patient transport (NEMT)
 * - Medical equipment delivery
 * - Cold chain logistics
 * - Controlled substance handling
 */

import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import type {
  ContactInfo,
  Coordinates,
  CreateMedicalDeliveryRequest,
  CreatePatientTransportRequest,
  DeliveryStatus,
  HealthcareProvider,
  MedicalDelivery,
  MedicalTransportType,
  PaginatedResponse,
  PaginationParams,
  PatientTransport,
  VehicleRequirement,
} from "../types/b2b.types";

// =============================================================================
// INTERFACES
// =============================================================================

interface TemperatureReading {
  timestamp: Date;
  temperature: number;
  sensorId: string;
  withinRange: boolean;
}

interface MedicalDeliveryVerification {
  type: "pickup" | "delivery";
  method: "id" | "signature" | "otp" | "pharmacy_code";
  verifiedAt: Date;
  verifiedBy?: string;
  idType?: string;
  idNumber?: string;
  signatureUrl?: string;
  otpVerified?: boolean;
  notes?: string;
}

interface DriverCertification {
  type: string;
  issuer: string;
  issuedAt: Date;
  expiresAt: Date;
  certificateNumber: string;
  verified: boolean;
}

interface MedicalVehicle {
  id: string;
  type: VehicleRequirement;
  plateNumber: string;
  isWheelchairAccessible: boolean;
  hasStretcher: boolean;
  hasOxygen: boolean;
  isColdChain: boolean;
  temperatureRange?: { min: number; max: number };
  certifications: string[];
  lastInspection: Date;
  isActive: boolean;
}

interface MedicalDeliveryFilters {
  providerId?: string;
  deliveryType?: MedicalTransportType;
  status?: DeliveryStatus;
  isUrgent?: boolean;
  requiresColdChain?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
}

interface PatientTransportFilters {
  providerId?: string;
  status?: string;
  appointmentDateFrom?: Date;
  appointmentDateTo?: Date;
}

// =============================================================================
// HEALTHCARE TRANSPORT SERVICE
// =============================================================================

export class HealthcareTransportService extends EventEmitter {
  private providers: Map<string, HealthcareProvider> = new Map();
  private medicalDeliveries: Map<string, MedicalDelivery> = new Map();
  private patientTransports: Map<string, PatientTransport> = new Map();
  private temperatureLogs: Map<string, TemperatureReading[]> = new Map();
  private medicalVehicles: Map<string, MedicalVehicle> = new Map();
  private driverCertifications: Map<string, DriverCertification[]> = new Map();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================

  /**
   * Register a healthcare provider
   */
  async registerProvider(
    organizationId: string,
    providerType: HealthcareProvider["providerType"],
    details: {
      licenseNumber?: string;
      licenseExpiry?: Date;
      certifications?: string[];
      operatingHours?: Record<string, { open: string; close: string }>;
      emergencyContact?: ContactInfo;
    }
  ): Promise<HealthcareProvider> {
    const provider: HealthcareProvider = {
      id: nanoid(),
      organizationId,
      providerType,
      licenseNumber: details.licenseNumber,
      licenseExpiry: details.licenseExpiry,
      certifications: details.certifications || [],
      operatingHours: details.operatingHours || {
        monday: { open: "08:00", close: "18:00" },
        tuesday: { open: "08:00", close: "18:00" },
        wednesday: { open: "08:00", close: "18:00" },
        thursday: { open: "08:00", close: "18:00" },
        friday: { open: "08:00", close: "18:00" },
      },
      emergencyContact: details.emergencyContact,
      settings: {
        requiresIdVerification: true,
        defaultProofOfDelivery: "signature",
        allowCOD: false,
        urgentSLAMinutes: 60,
        standardSLAMinutes: 240,
      },
    };

    this.providers.set(provider.id, provider);
    this.emit("provider:registered", provider);

    return provider;
  }

  /**
   * Update provider settings
   */
  async updateProvider(
    providerId: string,
    updates: Partial<HealthcareProvider>
  ): Promise<HealthcareProvider> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    Object.assign(provider, updates);
    this.providers.set(providerId, provider);

    return provider;
  }

  /**
   * Get provider by ID
   */
  async getProvider(providerId: string): Promise<HealthcareProvider | null> {
    return this.providers.get(providerId) || null;
  }

  /**
   * Get provider by organization ID
   */
  async getProviderByOrganization(
    organizationId: string
  ): Promise<HealthcareProvider | null> {
    return (
      Array.from(this.providers.values()).find(
        (p) => p.organizationId === organizationId
      ) || null
    );
  }

  // ===========================================================================
  // MEDICAL DELIVERY MANAGEMENT
  // ===========================================================================

  /**
   * Create a medical delivery
   */
  async createMedicalDelivery(
    providerId: string,
    request: CreateMedicalDeliveryRequest
  ): Promise<MedicalDelivery> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    // Validate delivery type permissions
    this.validateDeliveryType(provider, request.deliveryType);

    // Validate controlled substance requirements
    if (request.isControlledSubstance) {
      this.validateControlledSubstanceRequest(request);
    }

    // Generate booking reference
    // const _bookingRef = this.generateMedicalBookingReference(
    //   request.deliveryType
    // );

    const delivery: MedicalDelivery = {
      id: nanoid(),
      providerId,
      deliveryType: request.deliveryType,
      externalReference: request.externalReference,
      pickupAddress: this.getProviderAddress(provider),
      pickupCoordinates: await this.getProviderCoordinates(provider),
      pickupContact: request.pickupContact,
      deliveryAddress: request.deliveryAddress,
      deliveryCoordinates: request.deliveryCoordinates,
      deliveryContact: request.deliveryContact,
      patientReference: request.patientReference,
      packageDescription: request.packageDescription,
      isControlledSubstance: request.isControlledSubstance || false,
      requiresColdChain: request.requiresColdChain || false,
      temperatureRange: request.temperatureRange,
      isUrgent: request.isUrgent || false,
      requiresIdVerification: request.requiresIdVerification ?? true,
      requiresAgeVerification: request.requiresAgeVerification || false,
      minimumAge: request.minimumAge,
      requiresSignature: true,
      vehicleRequirement:
        request.vehicleRequirement || this.determineVehicleRequirement(request),
      handlingInstructions: request.handlingInstructions,
      status: "PENDING",
      temperatureLog: [],
      currency: "NGN",
      createdAt: new Date(),
    };

    this.medicalDeliveries.set(delivery.id, delivery);

    // Calculate SLA based on urgency
    const slaMinutes = delivery.isUrgent
      ? provider.settings?.urgentSLAMinutes || 60
      : provider.settings?.standardSLAMinutes || 240;

    this.emit("medicalDelivery:created", {
      delivery,
      slaDeadline: new Date(Date.now() + slaMinutes * 60 * 1000),
    });

    // Auto-dispatch for urgent deliveries
    if (delivery.isUrgent) {
      await this.dispatchMedicalDelivery(delivery.id);
    }

    return delivery;
  }

  /**
   * Dispatch medical delivery to driver
   */
  async dispatchMedicalDelivery(deliveryId: string): Promise<MedicalDelivery> {
    const delivery = this.medicalDeliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    // Find suitable driver with certifications
    const driver = await this.findCertifiedDriver(delivery);
    if (!driver) {
      this.emit("medicalDelivery:no_driver", delivery);
      return delivery;
    }

    delivery.driverId = driver.id;
    delivery.assignedAt = new Date();
    delivery.status = "DRIVER_ASSIGNED";

    this.medicalDeliveries.set(deliveryId, delivery);

    this.emit("medicalDelivery:dispatched", { delivery, driver });

    return delivery;
  }

  /**
   * Record pickup verification
   */
  async recordPickupVerification(
    deliveryId: string,
    verification: Omit<MedicalDeliveryVerification, "type" | "verifiedAt">
  ): Promise<MedicalDelivery> {
    const delivery = this.medicalDeliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    delivery.pickupVerification = {
      type: "pickup",
      verifiedAt: new Date(),
      ...verification,
    };
    delivery.pickedUpAt = new Date();
    delivery.status = "PICKED_UP";

    this.medicalDeliveries.set(deliveryId, delivery);

    this.emit("medicalDelivery:picked_up", delivery);

    return delivery;
  }

  /**
   * Record delivery verification
   */
  async recordDeliveryVerification(
    deliveryId: string,
    verification: Omit<MedicalDeliveryVerification, "type" | "verifiedAt">
  ): Promise<MedicalDelivery> {
    const delivery = this.medicalDeliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    // Validate ID verification if required
    if (delivery.requiresIdVerification && !verification.idType) {
      throw new Error("ID verification required");
    }

    // Validate age if required
    if (delivery.requiresAgeVerification && delivery.minimumAge) {
      // In production, validate age from ID
    }

    delivery.deliveryVerification = {
      type: "delivery",
      verifiedAt: new Date(),
      ...verification,
    };
    delivery.deliveredAt = new Date();
    delivery.status = "DELIVERED";

    this.medicalDeliveries.set(deliveryId, delivery);

    this.emit("medicalDelivery:delivered", delivery);

    return delivery;
  }

  /**
   * Record temperature reading
   */
  async recordTemperatureReading(
    deliveryId: string,
    reading: Omit<TemperatureReading, "withinRange">
  ): Promise<void> {
    const delivery = this.medicalDeliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    if (!delivery.requiresColdChain) {
      return; // Skip if not cold chain delivery
    }

    const withinRange = delivery.temperatureRange
      ? reading.temperature >= delivery.temperatureRange.min &&
        reading.temperature <= delivery.temperatureRange.max
      : true;

    const tempReading: TemperatureReading = {
      ...reading,
      withinRange,
    };

    delivery.temperatureLog.push({
      timestamp: reading.timestamp,
      temperature: reading.temperature,
    });

    const logs = this.temperatureLogs.get(deliveryId) || [];
    logs.push(tempReading);
    this.temperatureLogs.set(deliveryId, logs);

    this.medicalDeliveries.set(deliveryId, delivery);

    // Alert if temperature out of range
    if (!withinRange) {
      this.emit("medicalDelivery:temperature_alert", {
        delivery,
        reading: tempReading,
      });
    }
  }

  /**
   * Get medical delivery by ID
   */
  async getMedicalDelivery(
    deliveryId: string
  ): Promise<MedicalDelivery | null> {
    return this.medicalDeliveries.get(deliveryId) || null;
  }

  /**
   * List medical deliveries
   */
  async listMedicalDeliveries(
    organizationId: string,
    filters: MedicalDeliveryFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<MedicalDelivery>> {
    // Get provider for organization
    const provider = await this.getProviderByOrganization(organizationId);
    if (!provider) {
      return this.paginate([], pagination);
    }

    let deliveries = Array.from(this.medicalDeliveries.values()).filter(
      (d) => d.providerId === provider.id
    );

    // Apply filters
    if (filters.providerId) {
      deliveries = deliveries.filter(
        (d) => d.providerId === filters.providerId
      );
    }
    if (filters.deliveryType) {
      deliveries = deliveries.filter(
        (d) => d.deliveryType === filters.deliveryType
      );
    }
    if (filters.status) {
      deliveries = deliveries.filter((d) => d.status === filters.status);
    }
    if (filters.isUrgent !== undefined) {
      deliveries = deliveries.filter((d) => d.isUrgent === filters.isUrgent);
    }
    if (filters.requiresColdChain !== undefined) {
      deliveries = deliveries.filter(
        (d) => d.requiresColdChain === filters.requiresColdChain
      );
    }
    if (filters.dateFrom) {
      deliveries = deliveries.filter((d) => d.createdAt >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      deliveries = deliveries.filter((d) => d.createdAt <= filters.dateTo!);
    }

    deliveries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.paginate(deliveries, pagination);
  }

  // ===========================================================================
  // PATIENT TRANSPORT (NEMT)
  // ===========================================================================

  /**
   * Create a patient transport booking
   */
  async createPatientTransport(
    providerId: string,
    request: CreatePatientTransportRequest
  ): Promise<PatientTransport> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    // Generate booking reference
    const bookingReference = this.generatePatientTransportReference();

    // Calculate pickup time based on appointment
    const pickupTime = new Date(
      request.appointmentTime.getTime() - 60 * 60 * 1000
    ); // 1 hour before

    const transport: PatientTransport = {
      id: nanoid(),
      providerId,
      bookingReference,
      patientReference: request.patientReference,
      patientFirstName: request.patientFirstName,
      patientPhone: request.patientPhone,
      wheelchairAccessible: request.wheelchairAccessible || false,
      stretcherRequired: request.stretcherRequired || false,
      oxygenRequired: request.oxygenRequired || false,
      accompanyingPersons: request.accompanyingPersons || 0,
      medicalEquipment: request.medicalEquipment || [],
      pickupAddress: request.pickupAddress,
      pickupCoordinates: request.pickupCoordinates,
      pickupInstructions: request.pickupInstructions,
      destinationAddress: request.destinationAddress,
      destinationCoordinates: request.destinationCoordinates,
      destinationType: request.destinationType,
      appointmentTime: request.appointmentTime,
      pickupTime,
      returnTripRequired: request.returnTripRequired || false,
      estimatedReturnTime: request.estimatedReturnTime,
      status: "scheduled",
      medicalNotes: request.medicalNotes,
      currency: "NGN",
      createdAt: new Date(),
    };

    this.patientTransports.set(transport.id, transport);

    this.emit("patientTransport:created", transport);

    // Schedule driver assignment
    this.scheduleDriverAssignment(transport);

    return transport;
  }

  /**
   * Assign driver to patient transport
   */
  async assignTransportDriver(
    transportId: string,
    driverId: string,
    vehicleId: string
  ): Promise<PatientTransport> {
    const transport = this.patientTransports.get(transportId);
    if (!transport) {
      throw new Error("Transport not found");
    }

    // Verify vehicle meets requirements
    const vehicle = this.medicalVehicles.get(vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    if (transport.wheelchairAccessible && !vehicle.isWheelchairAccessible) {
      throw new Error("Vehicle is not wheelchair accessible");
    }

    if (transport.stretcherRequired && !vehicle.hasStretcher) {
      throw new Error("Vehicle does not have stretcher capability");
    }

    if (transport.oxygenRequired && !vehicle.hasOxygen) {
      throw new Error("Vehicle does not have oxygen equipment");
    }

    transport.driverId = driverId;
    transport.vehicleId = vehicleId;
    transport.assignedAt = new Date();
    transport.status = "driver_assigned";

    this.patientTransports.set(transportId, transport);

    this.emit("patientTransport:driver_assigned", transport);

    return transport;
  }

  /**
   * Start patient pickup
   */
  async startPatientPickup(transportId: string): Promise<PatientTransport> {
    const transport = this.patientTransports.get(transportId);
    if (!transport) {
      throw new Error("Transport not found");
    }

    transport.status = "en_route_pickup";
    this.patientTransports.set(transportId, transport);

    this.emit("patientTransport:en_route", transport);

    return transport;
  }

  /**
   * Record patient pickup
   */
  async recordPatientPickup(
    transportId: string,
    notes?: string
  ): Promise<PatientTransport> {
    const transport = this.patientTransports.get(transportId);
    if (!transport) {
      throw new Error("Transport not found");
    }

    transport.pickedUpAt = new Date();
    transport.status = "in_transit";
    if (notes) {
      transport.driverNotes = notes;
    }

    this.patientTransports.set(transportId, transport);

    this.emit("patientTransport:patient_picked_up", transport);

    return transport;
  }

  /**
   * Record arrival at destination
   */
  async recordArrival(transportId: string): Promise<PatientTransport> {
    const transport = this.patientTransports.get(transportId);
    if (!transport) {
      throw new Error("Transport not found");
    }

    transport.arrivedAt = new Date();
    transport.status = "arrived";

    this.patientTransports.set(transportId, transport);

    this.emit("patientTransport:arrived", transport);

    // If return trip required, schedule it
    if (transport.returnTripRequired && transport.estimatedReturnTime) {
      await this.scheduleReturnTrip(transport);
    }

    return transport;
  }

  /**
   * Complete patient transport
   */
  async completeTransport(
    transportId: string,
    actualPrice?: number
  ): Promise<PatientTransport> {
    const transport = this.patientTransports.get(transportId);
    if (!transport) {
      throw new Error("Transport not found");
    }

    transport.completedAt = new Date();
    transport.status = "completed";
    if (actualPrice) {
      transport.price = actualPrice;
    }

    this.patientTransports.set(transportId, transport);

    this.emit("patientTransport:completed", transport);

    return transport;
  }

  /**
   * Cancel patient transport
   */
  async cancelTransport(
    transportId: string,
    reason: string
  ): Promise<PatientTransport> {
    const transport = this.patientTransports.get(transportId);
    if (!transport) {
      throw new Error("Transport not found");
    }

    transport.status = "cancelled";
    transport.driverNotes = reason;

    this.patientTransports.set(transportId, transport);

    this.emit("patientTransport:cancelled", { transport, reason });

    return transport;
  }

  /**
   * Get patient transport by ID
   */
  async getPatientTransport(
    transportId: string
  ): Promise<PatientTransport | null> {
    return this.patientTransports.get(transportId) || null;
  }

  /**
   * Get patient transport by booking reference
   */
  async getTransportByBookingReference(
    bookingReference: string
  ): Promise<PatientTransport | null> {
    return (
      Array.from(this.patientTransports.values()).find(
        (t) => t.bookingReference === bookingReference
      ) || null
    );
  }

  /**
   * List patient transports
   */
  async listPatientTransports(
    organizationId: string,
    filters: PatientTransportFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<PatientTransport>> {
    const provider = await this.getProviderByOrganization(organizationId);
    if (!provider) {
      return this.paginate([], pagination);
    }

    let transports = Array.from(this.patientTransports.values()).filter(
      (t) => t.providerId === provider.id
    );

    if (filters.providerId) {
      transports = transports.filter(
        (t) => t.providerId === filters.providerId
      );
    }
    if (filters.status) {
      transports = transports.filter((t) => t.status === filters.status);
    }
    if (filters.appointmentDateFrom) {
      transports = transports.filter(
        (t) => t.appointmentTime >= filters.appointmentDateFrom!
      );
    }
    if (filters.appointmentDateTo) {
      transports = transports.filter(
        (t) => t.appointmentTime <= filters.appointmentDateTo!
      );
    }

    transports.sort(
      (a, b) => a.appointmentTime.getTime() - b.appointmentTime.getTime()
    );

    return this.paginate(transports, pagination);
  }

  /**
   * Get today's scheduled transports
   */
  async getTodaysTransports(providerId: string): Promise<PatientTransport[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return Array.from(this.patientTransports.values())
      .filter(
        (t) =>
          t.providerId === providerId &&
          t.appointmentTime >= today &&
          t.appointmentTime < tomorrow &&
          t.status !== "cancelled"
      )
      .sort(
        (a, b) => a.appointmentTime.getTime() - b.appointmentTime.getTime()
      );
  }

  // ===========================================================================
  // VEHICLE & DRIVER MANAGEMENT
  // ===========================================================================

  /**
   * Register a medical vehicle
   */
  async registerMedicalVehicle(
    vehicle: Omit<MedicalVehicle, "id">
  ): Promise<MedicalVehicle> {
    const medicalVehicle: MedicalVehicle = {
      id: nanoid(),
      ...vehicle,
    };

    this.medicalVehicles.set(medicalVehicle.id, medicalVehicle);

    return medicalVehicle;
  }

  /**
   * Add driver certification
   */
  async addDriverCertification(
    driverId: string,
    certification: Omit<DriverCertification, "verified">
  ): Promise<void> {
    const certs = this.driverCertifications.get(driverId) || [];

    certs.push({
      ...certification,
      verified: false, // Needs manual verification
    });

    this.driverCertifications.set(driverId, certs);
  }

  /**
   * Verify driver certification
   */
  async verifyDriverCertification(
    driverId: string,
    certificateNumber: string
  ): Promise<void> {
    const certs = this.driverCertifications.get(driverId);
    if (!certs) {
      throw new Error("Driver certifications not found");
    }

    const cert = certs.find((c) => c.certificateNumber === certificateNumber);
    if (!cert) {
      throw new Error("Certification not found");
    }

    cert.verified = true;
    this.driverCertifications.set(driverId, certs);
  }

  /**
   * Check if driver is certified for delivery type
   */
  async isDriverCertified(
    driverId: string,
    deliveryType: MedicalTransportType
  ): Promise<boolean> {
    const certs = this.driverCertifications.get(driverId) || [];

    const requiredCerts = this.getRequiredCertifications(deliveryType);
    const validCerts = certs.filter(
      (c) => c.verified && c.expiresAt > new Date()
    );

    return requiredCerts.every((required) =>
      validCerts.some((c) => c.type === required)
    );
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  /**
   * Get medical delivery statistics
   */
  async getMedicalDeliveryStats(
    providerId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<{
    totalDeliveries: number;
    completedDeliveries: number;
    urgentDeliveries: number;
    coldChainDeliveries: number;
    controlledSubstanceDeliveries: number;
    averageDeliveryTime: number;
    temperatureComplianceRate: number;
    byType: Record<MedicalTransportType, number>;
  }> {
    const deliveries = Array.from(this.medicalDeliveries.values()).filter(
      (d) =>
        d.providerId === providerId &&
        d.createdAt >= dateFrom &&
        d.createdAt <= dateTo
    );

    const byType: Record<string, number> = {};
    let totalDeliveryTime = 0;
    let completedCount = 0;
    let temperatureCompliant = 0;
    let coldChainCount = 0;

    for (const delivery of deliveries) {
      byType[delivery.deliveryType] = (byType[delivery.deliveryType] || 0) + 1;

      if (delivery.status === "DELIVERED" && delivery.deliveredAt) {
        completedCount++;
        totalDeliveryTime +=
          delivery.deliveredAt.getTime() - delivery.createdAt.getTime();
      }

      if (delivery.requiresColdChain) {
        coldChainCount++;
        if (this.isTemperatureCompliant(delivery)) {
          temperatureCompliant++;
        }
      }
    }

    return {
      totalDeliveries: deliveries.length,
      completedDeliveries: completedCount,
      urgentDeliveries: deliveries.filter((d) => d.isUrgent).length,
      coldChainDeliveries: coldChainCount,
      controlledSubstanceDeliveries: deliveries.filter(
        (d) => d.isControlledSubstance
      ).length,
      averageDeliveryTime:
        completedCount > 0
          ? Math.round(totalDeliveryTime / completedCount / 60000)
          : 0,
      temperatureComplianceRate:
        coldChainCount > 0
          ? (temperatureCompliant / coldChainCount) * 100
          : 100,
      byType: byType as Record<MedicalTransportType, number>,
    };
  }

  /**
   * Get patient transport statistics
   */
  async getPatientTransportStats(
    providerId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<{
    totalTransports: number;
    completedTransports: number;
    cancelledTransports: number;
    wheelchairTransports: number;
    stretcherTransports: number;
    averageWaitTime: number;
    onTimeRate: number;
  }> {
    const transports = Array.from(this.patientTransports.values()).filter(
      (t) =>
        t.providerId === providerId &&
        t.appointmentTime >= dateFrom &&
        t.appointmentTime <= dateTo
    );

    let onTimeCount = 0;
    let totalWaitTime = 0;
    let completedWithPickup = 0;

    for (const transport of transports) {
      if (
        transport.status === "completed" &&
        transport.arrivedAt &&
        transport.appointmentTime
      ) {
        if (transport.arrivedAt <= transport.appointmentTime) {
          onTimeCount++;
        }
      }

      if (transport.pickedUpAt && transport.pickupTime) {
        completedWithPickup++;
        totalWaitTime += Math.abs(
          transport.pickedUpAt.getTime() - transport.pickupTime.getTime()
        );
      }
    }

    return {
      totalTransports: transports.length,
      completedTransports: transports.filter((t) => t.status === "completed")
        .length,
      cancelledTransports: transports.filter((t) => t.status === "cancelled")
        .length,
      wheelchairTransports: transports.filter((t) => t.wheelchairAccessible)
        .length,
      stretcherTransports: transports.filter((t) => t.stretcherRequired).length,
      averageWaitTime:
        completedWithPickup > 0
          ? Math.round(totalWaitTime / completedWithPickup / 60000)
          : 0,
      onTimeRate:
        transports.filter((t) => t.status === "completed").length > 0
          ? (onTimeCount /
              transports.filter((t) => t.status === "completed").length) *
            100
          : 100,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private validateDeliveryType(
    provider: HealthcareProvider,
    deliveryType: MedicalTransportType
  ): void {
    const allowedTypes: Record<
      HealthcareProvider["providerType"],
      MedicalTransportType[]
    > = {
      hospital: [
        "PRESCRIPTION_DELIVERY",
        "LAB_SAMPLE_PICKUP",
        "PATIENT_TRANSPORT",
        "MEDICAL_EQUIPMENT",
        "ORGAN_TRANSPORT",
        "EMERGENCY_SUPPLY",
      ],
      clinic: [
        "PRESCRIPTION_DELIVERY",
        "LAB_SAMPLE_PICKUP",
        "PATIENT_TRANSPORT",
      ],
      pharmacy: ["PRESCRIPTION_DELIVERY"],
      lab: ["LAB_SAMPLE_PICKUP"],
      home_care: [
        "PRESCRIPTION_DELIVERY",
        "MEDICAL_EQUIPMENT",
        "PATIENT_TRANSPORT",
      ],
    };

    const allowed = allowedTypes[provider.providerType];
    if (!allowed.includes(deliveryType)) {
      throw new Error(
        `${deliveryType} not allowed for ${provider.providerType}`
      );
    }
  }

  private validateControlledSubstanceRequest(
    request: CreateMedicalDeliveryRequest
  ): void {
    if (!request.requiresIdVerification) {
      throw new Error("Controlled substances require ID verification");
    }
    if (!request.patientReference) {
      throw new Error("Controlled substances require patient reference");
    }
  }

  private determineVehicleRequirement(
    request: CreateMedicalDeliveryRequest
  ): VehicleRequirement {
    if (request.requiresColdChain) {
      return request.temperatureRange && request.temperatureRange.min < 0
        ? "COLD_CHAIN"
        : "TEMPERATURE_CONTROLLED";
    }

    if (request.deliveryType === "LAB_SAMPLE_PICKUP") {
      return "BIOHAZARD_CERTIFIED";
    }

    return "STANDARD";
  }

  // private _generateMedicalBookingReference(type: MedicalTransportType): string {
  //   const prefix = {
  //     PRESCRIPTION_DELIVERY: "RX",
  //     LAB_SAMPLE_PICKUP: "LAB",
  //     PATIENT_TRANSPORT: "PT",
  //     MEDICAL_EQUIPMENT: "ME",
  //     ORGAN_TRANSPORT: "ORG",
  //     EMERGENCY_SUPPLY: "EMG",
  //   };

  //   const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  //   const random = Math.random().toString(36).substring(2, 6).toUpperCase();

  //   return `${prefix[type]}${dateStr}${random}`;
  // }

  private generatePatientTransportReference(): string {
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `NEMT${dateStr}${random}`;
  }

  private getProviderAddress(_provider: HealthcareProvider): string {
    // In production, get from provider record
    return "Provider Address";
  }

  private async getProviderCoordinates(
    _provider: HealthcareProvider
  ): Promise<Coordinates> {
    // In production, get from provider record
    return { lat: 6.5244, lng: 3.3792 };
  }

  private async findCertifiedDriver(
    _delivery: MedicalDelivery
  ): Promise<{ id: string } | null> {
    // In production, query driver pool
    return { id: nanoid() };
  }

  private scheduleDriverAssignment(transport: PatientTransport): void {
    // Schedule driver assignment 2 hours before pickup
    const assignmentTime = new Date(
      transport.pickupTime.getTime() - 2 * 60 * 60 * 1000
    );
    const delay = Math.max(0, assignmentTime.getTime() - Date.now());

    setTimeout(() => {
      this.emit("patientTransport:needs_assignment", transport);
    }, delay);
  }

  private async scheduleReturnTrip(transport: PatientTransport): Promise<void> {
    // In production, create a new transport for return trip
    this.emit("patientTransport:return_scheduled", transport);
  }

  private getRequiredCertifications(
    deliveryType: MedicalTransportType
  ): string[] {
    const requirements: Record<MedicalTransportType, string[]> = {
      PRESCRIPTION_DELIVERY: ["HIPAA"],
      LAB_SAMPLE_PICKUP: ["HIPAA", "BIOHAZARD_HANDLING"],
      PATIENT_TRANSPORT: ["HIPAA", "FIRST_AID", "CPR"],
      MEDICAL_EQUIPMENT: ["HIPAA"],
      ORGAN_TRANSPORT: ["HIPAA", "ORGAN_TRANSPORT_CERTIFIED"],
      EMERGENCY_SUPPLY: ["HIPAA"],
    };

    return requirements[deliveryType];
  }

  private isTemperatureCompliant(delivery: MedicalDelivery): boolean {
    if (!delivery.requiresColdChain || !delivery.temperatureRange) {
      return true;
    }

    return delivery.temperatureLog.every(
      (reading) =>
        reading.temperature >= delivery.temperatureRange!.min &&
        reading.temperature <= delivery.temperatureRange!.max
    );
  }

  private paginate<T>(
    items: T[],
    params: PaginationParams
  ): PaginatedResponse<T> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      data: items.slice(start, end),
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const healthcareTransportService = new HealthcareTransportService();
