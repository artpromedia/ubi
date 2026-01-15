// ===========================================
// UBI Driver Experience Platform
// Fleet Owner Management Service
// ===========================================

import { EventEmitter } from "events";

import {
  ApplicationStatus,
  type AssignDriverInput,
  DRIVER_EVENTS,
  DriverTier,
  type FleetApplication,
  type FleetDashboard,
  type FleetDriver,
  FleetDriverStatus,
  type FleetEarnings,
  type FleetEarningsBreakdown,
  type FleetOwner,
  FleetOwnerStatus,
  type FleetStatus,
  FleetTier,
  type FleetVehicle,
  type IFleetOwnerService,
  MaintenanceStatus,
  type MaintenanceType,
  type VehicleMaintenance,
  VehicleStatus,
} from "../../types/driver.types";

// -----------------------------------------
// FLEET CONFIGURATION
// -----------------------------------------

const FLEET_COMMISSION_SPLIT = {
  owner: 15, // Owner keeps 15% of driver's net earnings
  platform: 10, // UBI takes 10% (reduced from normal)
  driver: 75, // Driver gets 75%
};

const FLEET_VEHICLE_LIMITS = {
  [FleetOwnerStatus.PENDING]: 0,
  [FleetOwnerStatus.APPROVED]: 10,
  [FleetOwnerStatus.SUSPENDED]: 0,
  [FleetOwnerStatus.TERMINATED]: 0,
};

// -----------------------------------------
// FLEET OWNER SERVICE
// -----------------------------------------

export class FleetOwnerService implements IFleetOwnerService {
  // @ts-expect-error - EventEmitter reserved for future event-driven features
  private _eventEmitter: EventEmitter;

  constructor(
    private db: any,
    // @ts-expect-error - Redis reserved for future caching features
    private _redis: any,
    private paymentService: any,
    private notificationService: any,
    private analyticsService: any,
  ) {
    this._eventEmitter = new EventEmitter();
  }

  // -----------------------------------------
  // FLEET OWNER APPLICATION
  // -----------------------------------------

  async applyForFleetProgram(
    driverId: string,
    application: FleetApplication,
  ): Promise<FleetOwner> {
    // Apply for fleet owner program
    await this.applyForFleetOwner(driverId, application);

    // Wait for the fleet owner record to be created (this happens in reviewApplication when approved)
    // For now, return a placeholder that will be created upon approval
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (!fleet) {
      throw new Error(
        "Fleet owner record not created. Application pending review.",
      );
    }

    return this.mapFleetOwner(fleet);
  }

  async applyForFleetOwner(
    driverId: string,
    application: FleetApplication,
  ): Promise<FleetApplication> {
    // Check eligibility
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
    });

    if (!profile) {
      throw new Error("Driver profile not found");
    }

    // Must be Platinum tier
    if (
      profile.currentTier !== DriverTier.PLATINUM &&
      profile.currentTier !== DriverTier.DIAMOND
    ) {
      throw new Error("Fleet Owner program requires Platinum or Diamond tier");
    }

    // Check existing application
    const existing = await this.db.fleetOwnerApplication.findFirst({
      where: {
        driverId,
        status: {
          in: [ApplicationStatus.PENDING, ApplicationStatus.UNDER_REVIEW],
        },
      },
    });

    if (existing) {
      throw new Error("You already have a pending application");
    }

    // Check if already a fleet owner
    const existingFleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (existingFleet) {
      throw new Error("You are already a fleet owner");
    }

    // Create application
    const newApplication = await this.db.fleetOwnerApplication.create({
      data: {
        driverId,
        businessName: application.businessName,
        businessType: application.businessType,
        registrationNumber: application.registrationNumber,
        taxId: application.taxId,
        contactEmail: application.contactEmail,
        contactPhone: application.contactPhone,
        plannedVehicles: application.plannedVehicles,
        businessPlan: application.businessPlan,
        status: ApplicationStatus.PENDING,
        submittedAt: new Date(),
      },
    });

    // Send confirmation
    await this.notificationService?.send({
      userId: driverId,
      title: "📋 Application Received",
      body: "Your Fleet Owner application has been received. We'll review it within 3-5 business days.",
      data: { type: "fleet_application", applicationId: newApplication.id },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.FLEET_APPLICATION, {
      applicationId: newApplication.id,
      plannedVehicles: application.plannedVehicles,
    });

    return this.mapApplication(newApplication);
  }

  async getApplicationStatus(
    driverId: string,
  ): Promise<FleetApplication | null> {
    const application = await this.db.fleetOwnerApplication.findFirst({
      where: { driverId },
      orderBy: { submittedAt: "desc" },
    });

    return application ? this.mapApplication(application) : null;
  }

  // Admin: Review application
  async reviewApplication(
    applicationId: string,
    reviewerId: string,
    approved: boolean,
    notes?: string,
  ): Promise<FleetApplication> {
    const application = await this.db.fleetOwnerApplication.update({
      where: { id: applicationId },
      data: {
        status: approved
          ? ApplicationStatus.APPROVED
          : ApplicationStatus.REJECTED,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: notes,
      },
    });

    if (approved) {
      // Create fleet owner record
      await this.createFleetOwner(application.driverId, application);
    }

    // Notify applicant
    await this.notificationService?.send({
      userId: application.driverId,
      title: approved
        ? "🎉 Application Approved!"
        : "❌ Application Not Approved",
      body: approved
        ? "Congratulations! You're now a Fleet Owner. Start adding vehicles to your fleet."
        : `Your Fleet Owner application was not approved. ${notes || "Contact support for details."}`,
      data: { type: "application_reviewed", applicationId, approved },
    });

    return this.mapApplication(application);
  }

  private async createFleetOwner(
    driverId: string,
    application: any,
  ): Promise<void> {
    await this.db.fleetOwner.create({
      data: {
        driverId,
        businessName: application.businessName,
        businessType: application.businessType,
        registrationNumber: application.registrationNumber,
        taxId: application.taxId,
        status: FleetOwnerStatus.APPROVED,
        maxVehicles: FLEET_VEHICLE_LIMITS[FleetOwnerStatus.APPROVED],
        commissionRate: FLEET_COMMISSION_SPLIT.owner,
        totalVehicles: 0,
        activeVehicles: 0,
        totalDrivers: 0,
        activeDrivers: 0,
        totalEarnings: 0,
        balance: 0,
      },
    });
  }

  // -----------------------------------------
  // FLEET OWNER PROFILE
  // -----------------------------------------

  async getFleetOwner(driverId: string): Promise<FleetOwner | null> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    return fleet ? this.mapFleetOwner(fleet) : null;
  }

  async getFleetDashboard(driverId: string): Promise<FleetDashboard> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayEarnings, todayTrips, activeVehicles, onlineDrivers] =
      await Promise.all([
        this.getTodayEarnings(fleet.id),
        this.getTodayTrips(fleet.id),
        this.db.fleetVehicle.count({
          where: { fleetId: fleet.id, status: VehicleStatus.ACTIVE },
        }),
        this.db.fleetDriver.count({
          where: {
            fleetId: fleet.id,
            status: FleetDriverStatus.ACTIVE,
            isOnline: true,
          },
        }),
      ]);

    // Get weekly comparison
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastWeekEarnings = await this.getEarningsForPeriod(
      fleet.id,
      lastWeek,
      today,
    );

    // Note: Additional metrics like weekly change, top vehicles/drivers, and maintenance alerts
    // could be added to the dashboard in future iterations

    return {
      fleet: this.mapFleetOwner(fleet),
      vehicles: [],
      drivers: [],
      todayStats: {
        totalTrips: todayTrips,
        grossEarnings: todayEarnings,
        netEarnings: todayEarnings,
        activeVehicles,
        activeDrivers: onlineDrivers,
        averageRating: 0,
        onlineHours: 0,
      },
      weekStats: {
        totalTrips: 0,
        grossEarnings: lastWeekEarnings,
        netEarnings: lastWeekEarnings,
        activeVehicles,
        activeDrivers: 0,
        averageRating: 0,
        onlineHours: 0,
      },
      monthStats: {
        totalTrips: 0,
        grossEarnings: parseFloat(fleet.totalEarnings),
        netEarnings: parseFloat(fleet.totalEarnings),
        activeVehicles,
        activeDrivers: 0,
        averageRating: 0,
        onlineHours: 0,
      },
      alerts: [],
      upcomingMaintenance: [],
    };
  }

  // -----------------------------------------
  // VEHICLE MANAGEMENT
  // -----------------------------------------

  async addVehicle(
    driverId: string,
    vehicle: Omit<FleetVehicle, "id" | "fleetId">,
  ): Promise<FleetVehicle> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    // Check vehicle limit
    if (fleet.totalVehicles >= fleet.maxVehicles) {
      throw new Error(
        `Vehicle limit reached (${fleet.maxVehicles}). Upgrade to add more vehicles.`,
      );
    }

    // Verify license plate uniqueness
    const existing = await this.db.fleetVehicle.findUnique({
      where: { plateNumber: vehicle.plateNumber },
    });

    if (existing) {
      throw new Error("A vehicle with this license plate already exists");
    }

    const newVehicle = await this.db.fleetVehicle.create({
      data: {
        fleetId: fleet.id,
        ...vehicle,
        status: VehicleStatus.PENDING_APPROVAL,
        totalTrips: 0,
        totalEarnings: 0,
        lastTripAt: null,
      },
    });

    // Update fleet counts
    await this.db.fleetOwner.update({
      where: { id: fleet.id },
      data: { totalVehicles: { increment: 1 } },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.VEHICLE_ADDED, {
      vehicleId: newVehicle.id,
      vehicleType: vehicle.vehicleType,
    });

    return this.mapFleetVehicle(newVehicle);
  }

  async getVehicles(driverId: string): Promise<FleetVehicle[]> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (!fleet) {
      return [];
    }

    const vehicles = await this.db.fleetVehicle.findMany({
      where: { fleetId: fleet.id },
      include: {
        assignedDriver: {
          select: { id: true, name: true, profileImage: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return vehicles.map(this.mapFleetVehicle);
  }

  async updateVehicle(
    driverId: string,
    vehicleId: string,
    updates: Partial<FleetVehicle>,
  ): Promise<FleetVehicle> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    const vehicle = await this.db.fleetVehicle.findFirst({
      where: { id: vehicleId, fleetId: fleet.id },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found in your fleet");
    }

    const updated = await this.db.fleetVehicle.update({
      where: { id: vehicleId },
      data: {
        make: updates.make,
        model: updates.model,
        year: updates.year,
        color: updates.color,
        insuranceExpiry: updates.insuranceExpiry,
        inspectionExpiry: updates.inspectionExpiry,
      },
    });

    return this.mapFleetVehicle(updated);
  }

  async removeVehicle(driverId: string, vehicleId: string): Promise<boolean> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    const vehicle = await this.db.fleetVehicle.findFirst({
      where: { id: vehicleId, fleetId: fleet.id },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found in your fleet");
    }

    // Cannot remove if driver is assigned
    if (vehicle.assignedDriverId) {
      throw new Error("Unassign the driver before removing the vehicle");
    }

    await this.db.fleetVehicle.update({
      where: { id: vehicleId },
      data: { status: VehicleStatus.DECOMMISSIONED },
    });

    // Update fleet counts
    await this.db.fleetOwner.update({
      where: { id: fleet.id },
      data: {
        totalVehicles: { decrement: 1 },
        ...(vehicle.status === VehicleStatus.ACTIVE && {
          activeVehicles: { decrement: 1 },
        }),
      },
    });

    return true;
  }

  // -----------------------------------------
  // DRIVER MANAGEMENT
  // -----------------------------------------

  async inviteDriver(
    fleetOwnerId: string,
    driverId: string,
    vehicleId?: string,
  ): Promise<FleetDriver> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    // Check if driver exists
    const driver = await this.db.driver.findUnique({
      where: { id: driverId },
    });

    if (!driver) {
      throw new Error("Driver not found");
    }

    // Check if already in a fleet
    const existingFleetDriver = await this.db.fleetDriver.findFirst({
      where: {
        driverId,
        status: { in: [FleetDriverStatus.SUSPENDED, FleetDriverStatus.ACTIVE] },
      },
    });

    if (existingFleetDriver) {
      throw new Error("Driver is already in a fleet");
    }

    // Verify vehicle belongs to fleet
    if (vehicleId) {
      const vehicle = await this.db.fleetVehicle.findFirst({
        where: { id: vehicleId, fleetId: fleet.id },
      });

      if (!vehicle) {
        throw new Error("Vehicle not found in your fleet");
      }
    }

    const fleetDriver = await this.db.fleetDriver.create({
      data: {
        fleetId: fleet.id,
        driverId,
        vehicleId,
        status: FleetDriverStatus.SUSPENDED,
        commissionRate: FLEET_COMMISSION_SPLIT.driver,
        totalTrips: 0,
        totalEarnings: 0,
        ownerEarnings: 0,
        invitedAt: new Date(),
      },
    });

    // Send invitation notification
    await this.notificationService?.send({
      userId: driverId,
      title: "🚗 Fleet Invitation",
      body: `${fleet.businessName} has invited you to join their fleet. Tap to view details.`,
      data: {
        type: "fleet_invitation",
        fleetId: fleet.id,
        invitationId: fleetDriver.id,
      },
    });

    return this.mapFleetDriver(fleetDriver);
  }

  async respondToInvitation(
    driverId: string,
    invitationId: string,
    accept: boolean,
  ): Promise<FleetDriver> {
    const invitation = await this.db.fleetDriver.findFirst({
      where: {
        id: invitationId,
        driverId,
        status: FleetDriverStatus.SUSPENDED,
      },
      include: { fleet: true },
    });

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    const fleetDriver = await this.db.fleetDriver.update({
      where: { id: invitationId },
      data: {
        status: accept
          ? FleetDriverStatus.ACTIVE
          : FleetDriverStatus.TERMINATED,
        respondedAt: new Date(),
        ...(accept && { joinedAt: new Date() }),
      },
    });

    if (accept) {
      // Update fleet counts
      await this.db.fleetOwner.update({
        where: { id: invitation.fleetId },
        data: {
          totalDrivers: { increment: 1 },
          activeDrivers: { increment: 1 },
        },
      });

      // If vehicle was assigned, update it
      if (invitation.vehicleId) {
        await this.db.fleetVehicle.update({
          where: { id: invitation.vehicleId },
          data: {
            assignedDriverId: driverId,
            status: VehicleStatus.ACTIVE,
          },
        });

        await this.db.fleetOwner.update({
          where: { id: invitation.fleetId },
          data: { activeVehicles: { increment: 1 } },
        });
      }
    }

    // Notify fleet owner
    await this.notificationService?.send({
      userId: invitation.fleet.driverId,
      title: accept ? "✅ Invitation Accepted" : "❌ Invitation Declined",
      body: accept
        ? `A driver has joined your fleet!`
        : `A driver has declined your fleet invitation.`,
      data: { type: "invitation_response", accepted: accept },
    });

    return this.mapFleetDriver(fleetDriver);
  }

  async getFleetDrivers(fleetOwnerId: string): Promise<FleetDriver[]> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      return [];
    }

    const drivers = await this.db.fleetDriver.findMany({
      where: { fleetId: fleet.id },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            profileImage: true,
          },
        },
        vehicle: true,
      },
      orderBy: { joinedAt: "desc" },
    });

    return drivers.map(this.mapFleetDriver);
  }

  async assignDriver(
    fleetOwnerId: string,
    input: AssignDriverInput,
  ): Promise<FleetDriver> {
    // Invite the driver first
    await this.inviteDriver(fleetOwnerId, input.driverId, input.vehicleId);

    // Get the created fleet driver record
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    const fleetDriver = await this.db.fleetDriver.findFirst({
      where: {
        fleetId: fleet.id,
        driverId: input.driverId,
      },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            profileImage: true,
          },
        },
        vehicle: true,
      },
    });

    if (!fleetDriver) {
      throw new Error("Failed to create fleet driver assignment");
    }

    return this.mapFleetDriver(fleetDriver);
  }

  async unassignDriver(
    fleetOwnerId: string,
    driverId: string,
  ): Promise<boolean> {
    return this.removeDriverFromFleet(fleetOwnerId, driverId);
  }

  async assignVehicleToDriver(
    fleetOwnerId: string,
    driverId: string,
    vehicleId: string,
  ): Promise<boolean> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    // Verify driver is in fleet
    const fleetDriver = await this.db.fleetDriver.findFirst({
      where: {
        fleetId: fleet.id,
        driverId,
        status: FleetDriverStatus.ACTIVE,
      },
    });

    if (!fleetDriver) {
      throw new Error("Driver not found in your fleet");
    }

    // Verify vehicle
    const vehicle = await this.db.fleetVehicle.findFirst({
      where: { id: vehicleId, fleetId: fleet.id },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found in your fleet");
    }

    // Unassign from previous driver if any
    if (vehicle.assignedDriverId) {
      await this.db.fleetDriver.updateMany({
        where: { fleetId: fleet.id, vehicleId },
        data: { vehicleId: null },
      });
    }

    // Unassign driver's previous vehicle
    if (fleetDriver.vehicleId) {
      await this.db.fleetVehicle.update({
        where: { id: fleetDriver.vehicleId },
        data: { assignedDriverId: null },
      });
    }

    // Assign vehicle
    await this.db.fleetDriver.update({
      where: { id: fleetDriver.id },
      data: { vehicleId },
    });

    await this.db.fleetVehicle.update({
      where: { id: vehicleId },
      data: {
        assignedDriverId: driverId,
        status: VehicleStatus.ACTIVE,
      },
    });

    return true;
  }

  async removeDriverFromFleet(
    fleetOwnerId: string,
    driverId: string,
  ): Promise<boolean> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    const fleetDriver = await this.db.fleetDriver.findFirst({
      where: {
        fleetId: fleet.id,
        driverId,
        status: FleetDriverStatus.ACTIVE,
      },
    });

    if (!fleetDriver) {
      throw new Error("Driver not found in your fleet");
    }

    // Unassign vehicle
    if (fleetDriver.vehicleId) {
      await this.db.fleetVehicle.update({
        where: { id: fleetDriver.vehicleId },
        data: { assignedDriverId: null },
      });
    }

    // Update fleet driver status
    await this.db.fleetDriver.update({
      where: { id: fleetDriver.id },
      data: {
        status: FleetDriverStatus.TERMINATED,
        leftAt: new Date(),
        vehicleId: null,
      },
    });

    // Update fleet counts
    await this.db.fleetOwner.update({
      where: { id: fleet.id },
      data: {
        totalDrivers: { decrement: 1 },
        activeDrivers: { decrement: 1 },
      },
    });

    // Notify driver
    await this.notificationService?.send({
      userId: driverId,
      title: "🚗 Fleet Status Update",
      body: `You have been removed from ${fleet.businessName}'s fleet.`,
      data: { type: "removed_from_fleet", fleetId: fleet.id },
    });

    return true;
  }

  // -----------------------------------------
  // EARNINGS
  // -----------------------------------------

  async getFleetEarnings(
    fleetOwnerId: string,
    period: "week" | "month",
  ): Promise<FleetEarnings> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    // Calculate date range based on period
    const endDate = new Date();
    const startDate = new Date();
    if (period === "week") {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate.setMonth(startDate.getMonth() - 1);
    }

    const earnings = await this.db.fleetEarnings.findMany({
      where: {
        fleetId: fleet.id,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        vehicle: true,
        driver: {
          select: { id: true, name: true },
        },
      },
    });

    // Aggregate by day
    const dailyBreakdown: Record<string, FleetEarningsBreakdown> = {};

    for (const earning of earnings) {
      const dateKey = earning.date.toISOString().split("T")[0];
      if (!dailyBreakdown[dateKey]) {
        dailyBreakdown[dateKey] = {
          date: earning.date,
          totalEarnings: 0,
          ownerShare: 0,
          driverShare: 0,
          platformFee: 0,
          trips: 0,
        };
      }

      dailyBreakdown[dateKey].totalEarnings += parseFloat(
        earning.totalEarnings,
      );
      dailyBreakdown[dateKey].ownerShare += parseFloat(earning.ownerShare);
      dailyBreakdown[dateKey].driverShare += parseFloat(earning.driverShare);
      dailyBreakdown[dateKey].platformFee += parseFloat(earning.platformFee);
      dailyBreakdown[dateKey].trips += earning.trips;
    }

    // Calculate totals
    const totalEarnings = Object.values(dailyBreakdown).reduce(
      (sum, d) => sum + d.totalEarnings,
      0,
    );
    const ownerShare = Object.values(dailyBreakdown).reduce(
      (sum, d) => sum + d.ownerShare,
      0,
    );
    const totalTrips = Object.values(dailyBreakdown).reduce(
      (sum, d) => sum + d.trips,
      0,
    );

    // Get vehicle breakdown
    const vehicleBreakdown = await this.getVehicleEarningsBreakdown(
      fleet.id,
      startDate,
      endDate,
    );

    // Get driver breakdown
    const driverBreakdown = await this.getDriverEarningsBreakdown(
      fleet.id,
      startDate,
      endDate,
    );

    return {
      fleetId: fleet.id,
      period: { start: startDate, end: endDate },
      totalEarnings,
      ownerShare,
      totalTrips,
      dailyBreakdown: Object.values(dailyBreakdown).sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      ),
      vehicleBreakdown,
      driverBreakdown,
    };
  }

  async processFleetTrip(
    _tripId: string,
    driverId: string,
    tripEarning: number,
  ): Promise<void> {
    // Check if driver is in a fleet
    const fleetDriver = await this.db.fleetDriver.findFirst({
      where: { driverId, status: FleetDriverStatus.ACTIVE },
      include: { fleet: true },
    });

    if (!fleetDriver) {
      return;
    }

    // Calculate splits
    const ownerShare = tripEarning * (FLEET_COMMISSION_SPLIT.owner / 100);
    const driverShare = tripEarning * (FLEET_COMMISSION_SPLIT.driver / 100);
    const platformFee = tripEarning * (FLEET_COMMISSION_SPLIT.platform / 100);

    // Record fleet earning
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.db.fleetEarnings.upsert({
      where: {
        fleetId_vehicleId_driverId_date: {
          fleetId: fleetDriver.fleetId,
          vehicleId: fleetDriver.vehicleId || "no_vehicle",
          driverId,
          date: today,
        },
      },
      update: {
        totalEarnings: { increment: tripEarning },
        ownerShare: { increment: ownerShare },
        driverShare: { increment: driverShare },
        platformFee: { increment: platformFee },
        trips: { increment: 1 },
      },
      create: {
        fleetId: fleetDriver.fleetId,
        vehicleId: fleetDriver.vehicleId,
        driverId,
        date: today,
        totalEarnings: tripEarning,
        ownerShare,
        driverShare,
        platformFee,
        trips: 1,
      },
    });

    // Update fleet driver stats
    await this.db.fleetDriver.update({
      where: { id: fleetDriver.id },
      data: {
        totalTrips: { increment: 1 },
        totalEarnings: { increment: driverShare },
        ownerEarnings: { increment: ownerShare },
      },
    });

    // Update fleet owner balance
    await this.db.fleetOwner.update({
      where: { id: fleetDriver.fleetId },
      data: {
        totalEarnings: { increment: ownerShare },
        balance: { increment: ownerShare },
      },
    });

    // Update vehicle stats
    if (fleetDriver.vehicleId) {
      await this.db.fleetVehicle.update({
        where: { id: fleetDriver.vehicleId },
        data: {
          totalTrips: { increment: 1 },
          totalEarnings: { increment: tripEarning },
          lastTripAt: new Date(),
        },
      });
    }
  }

  async requestPayout(fleetOwnerId: string, amount: number): Promise<boolean> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    if (parseFloat(fleet.balance) < amount) {
      throw new Error("Insufficient balance");
    }

    // Deduct from balance
    await this.db.fleetOwner.update({
      where: { id: fleet.id },
      data: { balance: { decrement: amount } },
    });

    // Process payout to owner's wallet
    await this.paymentService?.creditWallet(
      fleetOwnerId,
      amount,
      "Fleet owner payout",
    );

    // Record payout
    await this.db.fleetPayout.create({
      data: {
        fleetId: fleet.id,
        amount,
        status: "COMPLETED",
        processedAt: new Date(),
      },
    });

    return true;
  }

  // -----------------------------------------
  // MAINTENANCE
  // -----------------------------------------

  async scheduleMaintenance(
    fleetOwnerId: string,
    vehicleId: string,
    maintenance: Omit<VehicleMaintenance, "id" | "vehicleId">,
  ): Promise<VehicleMaintenance> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
    }

    const vehicle = await this.db.fleetVehicle.findFirst({
      where: { id: vehicleId, fleetId: fleet.id },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found in your fleet");
    }

    const record = await this.db.vehicleMaintenance.create({
      data: {
        vehicleId,
        ...maintenance,
        status: MaintenanceStatus.SCHEDULED,
      },
    });

    // Notify assigned driver if any
    if (vehicle.assignedDriverId && maintenance.scheduledDate) {
      await this.notificationService?.send({
        userId: vehicle.assignedDriverId,
        title: "🔧 Maintenance Scheduled",
        body: `Your vehicle has ${maintenance.maintenanceType} maintenance scheduled for ${maintenance.scheduledDate.toDateString()}`,
        data: { type: "maintenance_scheduled", vehicleId },
      });
    }

    return this.mapMaintenance(record);
  }

  async getMaintenanceHistory(
    fleetOwnerId: string,
    vehicleId?: string,
  ): Promise<VehicleMaintenance[]> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      return [];
    }

    const where: any = {
      vehicle: { fleetId: fleet.id },
    };
    if (vehicleId) {
      where.vehicleId = vehicleId;
    }

    const records = await this.db.vehicleMaintenance.findMany({
      where,
      include: { vehicle: true },
      orderBy: { scheduledDate: "desc" },
    });

    return records.map(this.mapMaintenance);
  }

  async completeMaintenance(
    maintenanceId: string,
    completionData: {
      actualCost: number;
      notes?: string;
      nextServiceMileage?: number;
      nextServiceDate?: Date;
    },
  ): Promise<VehicleMaintenance> {
    const record = await this.db.vehicleMaintenance.update({
      where: { id: maintenanceId },
      data: {
        status: MaintenanceStatus.COMPLETED,
        completedAt: new Date(),
        actualCost: completionData.actualCost,
        notes: completionData.notes,
        nextServiceMileage: completionData.nextServiceMileage,
        nextServiceDate: completionData.nextServiceDate,
      },
    });

    // Update vehicle last maintenance date
    await this.db.fleetVehicle.update({
      where: { id: record.vehicleId },
      data: {
        lastMaintenanceAt: new Date(),
        nextMaintenanceAt: completionData.nextServiceDate,
      },
    });

    return this.mapMaintenance(record);
  }

  // -----------------------------------------
  // PRIVATE HELPERS
  // -----------------------------------------

  private async getTodayEarnings(fleetId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await this.db.fleetEarnings.aggregate({
      where: { fleetId, date: today },
      _sum: { ownerShare: true },
    });

    return parseFloat(result._sum.ownerShare || "0");
  }

  private async getTodayTrips(fleetId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await this.db.fleetEarnings.aggregate({
      where: { fleetId, date: today },
      _sum: { trips: true },
    });

    return result._sum.trips || 0;
  }

  private async getEarningsForPeriod(
    fleetId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await this.db.fleetEarnings.aggregate({
      where: {
        fleetId,
        date: { gte: start, lt: end },
      },
      _sum: { ownerShare: true },
    });

    return parseFloat(result._sum.ownerShare || "0");
  }

  // Helper methods removed - to be reimplemented when needed for dashboard enhancements

  private async getVehicleEarningsBreakdown(
    fleetId: string,
    start: Date,
    end: Date,
  ): Promise<
    {
      vehicleId: string;
      licensePlate: string;
      earnings: number;
      trips: number;
    }[]
  > {
    const earnings = await this.db.fleetEarnings.groupBy({
      by: ["vehicleId"],
      where: {
        fleetId,
        date: { gte: start, lte: end },
        vehicleId: { not: null },
      },
      _sum: { totalEarnings: true, trips: true },
    });

    const vehicleIds = earnings.map((e: any) => e.vehicleId).filter(Boolean);
    const vehicles = await this.db.fleetVehicle.findMany({
      where: { id: { in: vehicleIds } },
    });
    const vehicleMap = new Map(vehicles.map((v: any) => [v.id, v]));

    return earnings.map((e: any) => {
      const vehicle = vehicleMap.get(e.vehicleId) as any;
      return {
        vehicleId: e.vehicleId,
        licensePlate: vehicle?.plateNumber || "Unknown",
        earnings: parseFloat(e._sum.totalEarnings || "0"),
        trips: e._sum.trips || 0,
      };
    });
  }

  private async getDriverEarningsBreakdown(
    fleetId: string,
    start: Date,
    end: Date,
  ): Promise<
    { driverId: string; name: string; earnings: number; trips: number }[]
  > {
    const earnings = await this.db.fleetEarnings.groupBy({
      by: ["driverId"],
      where: {
        fleetId,
        date: { gte: start, lte: end },
      },
      _sum: { driverShare: true, trips: true },
    });

    const driverIds = earnings.map((e: any) => e.driverId);
    const drivers = await this.db.driver.findMany({
      where: { id: { in: driverIds } },
      select: { id: true, name: true },
    });
    const driverMap = new Map(drivers.map((d: any) => [d.id, d]));

    return earnings.map((e: any) => {
      const driver = driverMap.get(e.driverId) as any;
      return {
        driverId: e.driverId,
        name: driver?.name || "Unknown",
        earnings: parseFloat(e._sum.driverShare || "0"),
        trips: e._sum.trips || 0,
      };
    });
  }

  // Mappers
  private mapFleetOwner(f: any): FleetOwner {
    return {
      id: f.id,
      ownerId: f.driverId,
      businessName: f.businessName,
      businessType: f.businessType,
      registrationNumber: f.registrationNumber,
      taxId: f.taxId,
      status: f.status as FleetStatus,
      approvedAt: f.approvedAt,
      fleetTier: f.fleetTier || FleetTier.STARTER,
      commissionRate: parseFloat(f.commissionRate),
      vehicleCount: f.totalVehicles,
      activeDrivers: f.activeDrivers,
      contactEmail: f.contactEmail || "",
      contactPhone: f.contactPhone || "",
    };
  }

  private mapFleetVehicle(v: any): FleetVehicle {
    return {
      id: v.id,
      fleetId: v.fleetId,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      plateNumber: v.plateNumber || v.licensePlate,
      vin: v.vin || v.vinNumber,
      vehicleType: v.vehicleType,
      fuelType: v.fuelType,
      seatingCapacity: v.seatingCapacity,
      status: v.status as VehicleStatus,
      assignedDriverId: v.assignedDriverId,
      assignedDriver: v.assignedDriver,
      currentLocation: v.currentLocation,
      lastLocationAt: v.lastLocationAt,
      odometer: v.odometer,
      insuranceExpiry: v.insuranceExpiry,
      inspectionExpiry: v.inspectionExpiry || v.registrationExpiry,
      todayTrips: v.todayTrips,
      todayEarnings: v.todayEarnings,
    };
  }

  private mapFleetDriver(d: any): FleetDriver {
    return {
      id: d.id,
      fleetId: d.fleetId,
      driverId: d.driverId,
      driver: d.driver,
      vehicleId: d.vehicleId,
      vehicle: d.vehicle ? this.mapFleetVehicle(d.vehicle) : undefined,
      assignedAt: d.assignedAt || d.invitedAt || d.joinedAt || new Date(),
      status: d.status as FleetDriverStatus,
      revenueSharePercent: parseFloat(
        d.commissionRate || d.revenueSharePercent || "0",
      ),
      weeklyTarget: d.weeklyTarget,
      monthlyTrips: d.monthlyTrips || d.totalTrips || 0,
      monthlyEarnings: parseFloat(d.monthlyEarnings || d.totalEarnings || "0"),
    };
  }

  private mapApplication(a: any): FleetApplication {
    return {
      driverId: a.driverId,
      businessName: a.businessName,
      businessType: a.businessType,
      registrationNumber: a.registrationNumber,
      taxId: a.taxId,
      contactEmail: a.contactEmail || "",
      contactPhone: a.contactPhone || "",
      plannedVehicles: a.plannedVehicles || a.vehicleCount || 0,
      businessPlan: a.businessPlan || a.documents,
    };
  }

  private mapMaintenance(m: any): VehicleMaintenance {
    return {
      id: m.id,
      vehicleId: m.vehicleId,
      vehicle: m.vehicle,
      maintenanceType: m.maintenanceType as MaintenanceType,
      description: m.description,
      scheduledDate: m.scheduledDate,
      completedDate: m.completedDate || m.completedAt,
      cost:
        m.cost || m.actualCost ? parseFloat(m.cost || m.actualCost) : undefined,
      currency: m.currency,
      provider: m.provider || m.serviceProvider,
      odometerAtService: m.odometerAtService,
      nextServiceOdometer: m.nextServiceOdometer || m.nextServiceMileage,
      nextServiceDate: m.nextServiceDate,
      status: m.status as MaintenanceStatus,
    };
  }

  private trackEvent(
    driverId: string,
    eventName: string,
    properties: Record<string, unknown>,
  ): void {
    this.analyticsService?.track({
      userId: driverId,
      event: eventName,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
