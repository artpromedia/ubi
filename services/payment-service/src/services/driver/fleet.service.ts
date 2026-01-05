// ===========================================
// UBI Driver Experience Platform
// Fleet Owner Management Service
// ===========================================

import { EventEmitter } from "events";
import {
  ApplicationStatus,
  DRIVER_EVENTS,
  DriverTier,
  FleetApplication,
  FleetDashboard,
  FleetDriver,
  FleetDriverStatus,
  FleetEarnings,
  FleetEarningsBreakdown,
  FleetOwner,
  FleetOwnerStatus,
  FleetVehicle,
  IFleetOwnerService,
  MaintenanceStatus,
  MaintenanceType,
  VehicleMaintenance,
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
  [FleetOwnerStatus.ACTIVE]: 10,
  [FleetOwnerStatus.PREMIUM]: 50,
  [FleetOwnerStatus.ENTERPRISE]: 200,
};

// -----------------------------------------
// FLEET OWNER SERVICE
// -----------------------------------------

export class FleetOwnerService implements IFleetOwnerService {
  private eventEmitter: EventEmitter;

  constructor(
    private db: any,
    private redis: any,
    private paymentService: any,
    private notificationService: any,
    private analyticsService: any
  ) {
    this.eventEmitter = new EventEmitter();
  }

  // -----------------------------------------
  // FLEET OWNER APPLICATION
  // -----------------------------------------

  async applyForFleetOwner(
    driverId: string,
    application: FleetApplication
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
        address: application.address,
        city: application.city,
        vehicleCount: application.vehicleCount,
        documents: application.documents,
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
    this.trackEvent(driverId, DRIVER_EVENTS.FLEET_APPLICATION_SUBMITTED, {
      applicationId: newApplication.id,
      vehicleCount: application.vehicleCount,
    });

    return this.mapApplication(newApplication);
  }

  async getApplicationStatus(
    driverId: string
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
    notes?: string
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
    application: any
  ): Promise<void> {
    await this.db.fleetOwner.create({
      data: {
        driverId,
        businessName: application.businessName,
        businessType: application.businessType,
        registrationNumber: application.registrationNumber,
        taxId: application.taxId,
        address: application.address,
        city: application.city,
        status: FleetOwnerStatus.ACTIVE,
        maxVehicles: FLEET_VEHICLE_LIMITS[FleetOwnerStatus.ACTIVE],
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
      today
    );

    const twoWeeksAgo = new Date(lastWeek);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);
    const previousWeekEarnings = await this.getEarningsForPeriod(
      fleet.id,
      twoWeeksAgo,
      lastWeek
    );

    const weeklyChange =
      previousWeekEarnings > 0
        ? ((lastWeekEarnings - previousWeekEarnings) / previousWeekEarnings) *
          100
        : 0;

    // Get top performing vehicles and drivers
    const topVehicles = await this.getTopVehicles(fleet.id, 5);
    const topDrivers = await this.getTopDrivers(fleet.id, 5);

    // Get maintenance alerts
    const maintenanceAlerts = await this.getMaintenanceAlerts(fleet.id);

    return {
      fleetId: fleet.id,
      todayEarnings,
      todayTrips,
      weeklyEarnings: lastWeekEarnings,
      weeklyChange,
      monthlyEarnings: parseFloat(fleet.totalEarnings),
      totalVehicles: fleet.totalVehicles,
      activeVehicles,
      totalDrivers: fleet.totalDrivers,
      onlineDrivers,
      balance: parseFloat(fleet.balance),
      topVehicles,
      topDrivers,
      maintenanceAlerts,
      lastUpdated: new Date(),
    };
  }

  // -----------------------------------------
  // VEHICLE MANAGEMENT
  // -----------------------------------------

  async addVehicle(
    driverId: string,
    vehicle: Omit<FleetVehicle, "id" | "fleetId">
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
        `Vehicle limit reached (${fleet.maxVehicles}). Upgrade to add more vehicles.`
      );
    }

    // Verify license plate uniqueness
    const existing = await this.db.fleetVehicle.findUnique({
      where: { licensePlate: vehicle.licensePlate },
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
    this.trackEvent(driverId, DRIVER_EVENTS.FLEET_VEHICLE_ADDED, {
      vehicleId: newVehicle.id,
      vehicleType: vehicle.vehicleType,
    });

    return this.mapFleetVehicle(newVehicle);
  }

  async getVehicles(driverId: string): Promise<FleetVehicle[]> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId },
    });

    if (!fleet) return [];

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
    updates: Partial<FleetVehicle>
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
        registrationExpiry: updates.registrationExpiry,
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
    vehicleId?: string
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
        status: { in: [FleetDriverStatus.PENDING, FleetDriverStatus.ACTIVE] },
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
        status: FleetDriverStatus.PENDING,
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
    accept: boolean
  ): Promise<FleetDriver> {
    const invitation = await this.db.fleetDriver.findFirst({
      where: { id: invitationId, driverId, status: FleetDriverStatus.PENDING },
      include: { fleet: true },
    });

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    const fleetDriver = await this.db.fleetDriver.update({
      where: { id: invitationId },
      data: {
        status: accept ? FleetDriverStatus.ACTIVE : FleetDriverStatus.DECLINED,
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

    if (!fleet) return [];

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

  async assignVehicleToDriver(
    fleetOwnerId: string,
    driverId: string,
    vehicleId: string
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
    driverId: string
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
        status: FleetDriverStatus.REMOVED,
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
    startDate: Date,
    endDate: Date
  ): Promise<FleetEarnings> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) {
      throw new Error("Fleet owner not found");
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
        earning.totalEarnings
      );
      dailyBreakdown[dateKey].ownerShare += parseFloat(earning.ownerShare);
      dailyBreakdown[dateKey].driverShare += parseFloat(earning.driverShare);
      dailyBreakdown[dateKey].platformFee += parseFloat(earning.platformFee);
      dailyBreakdown[dateKey].trips += earning.trips;
    }

    // Calculate totals
    const totalEarnings = Object.values(dailyBreakdown).reduce(
      (sum, d) => sum + d.totalEarnings,
      0
    );
    const ownerShare = Object.values(dailyBreakdown).reduce(
      (sum, d) => sum + d.ownerShare,
      0
    );
    const totalTrips = Object.values(dailyBreakdown).reduce(
      (sum, d) => sum + d.trips,
      0
    );

    // Get vehicle breakdown
    const vehicleBreakdown = await this.getVehicleEarningsBreakdown(
      fleet.id,
      startDate,
      endDate
    );

    // Get driver breakdown
    const driverBreakdown = await this.getDriverEarningsBreakdown(
      fleet.id,
      startDate,
      endDate
    );

    return {
      fleetId: fleet.id,
      period: { start: startDate, end: endDate },
      totalEarnings,
      ownerShare,
      totalTrips,
      dailyBreakdown: Object.values(dailyBreakdown).sort(
        (a, b) => a.date.getTime() - b.date.getTime()
      ),
      vehicleBreakdown,
      driverBreakdown,
    };
  }

  async processFleetTrip(
    tripId: string,
    driverId: string,
    tripEarning: number
  ): Promise<void> {
    // Check if driver is in a fleet
    const fleetDriver = await this.db.fleetDriver.findFirst({
      where: { driverId, status: FleetDriverStatus.ACTIVE },
      include: { fleet: true },
    });

    if (!fleetDriver) return;

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
      "Fleet owner payout"
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
    maintenance: Omit<VehicleMaintenance, "id" | "vehicleId">
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
    if (vehicle.assignedDriverId) {
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
    vehicleId?: string
  ): Promise<VehicleMaintenance[]> {
    const fleet = await this.db.fleetOwner.findUnique({
      where: { driverId: fleetOwnerId },
    });

    if (!fleet) return [];

    const where: any = {
      vehicle: { fleetId: fleet.id },
    };
    if (vehicleId) where.vehicleId = vehicleId;

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
    }
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
    end: Date
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

  private async getTopVehicles(
    fleetId: string,
    limit: number
  ): Promise<{ vehicleId: string; licensePlate: string; earnings: number }[]> {
    const vehicles = await this.db.fleetVehicle.findMany({
      where: { fleetId, status: VehicleStatus.ACTIVE },
      orderBy: { totalEarnings: "desc" },
      take: limit,
    });

    return vehicles.map((v: any) => ({
      vehicleId: v.id,
      licensePlate: v.licensePlate,
      earnings: parseFloat(v.totalEarnings),
    }));
  }

  private async getTopDrivers(
    fleetId: string,
    limit: number
  ): Promise<{ driverId: string; name: string; earnings: number }[]> {
    const drivers = await this.db.fleetDriver.findMany({
      where: { fleetId, status: FleetDriverStatus.ACTIVE },
      include: { driver: { select: { name: true } } },
      orderBy: { totalEarnings: "desc" },
      take: limit,
    });

    return drivers.map((d: any) => ({
      driverId: d.driverId,
      name: d.driver.name,
      earnings: parseFloat(d.totalEarnings),
    }));
  }

  private async getMaintenanceAlerts(
    fleetId: string
  ): Promise<{ vehicleId: string; licensePlate: string; alert: string }[]> {
    const vehicles = await this.db.fleetVehicle.findMany({
      where: {
        fleetId,
        status: VehicleStatus.ACTIVE,
        OR: [
          { nextMaintenanceAt: { lte: new Date() } },
          { insuranceExpiry: { lte: new Date() } },
          { registrationExpiry: { lte: new Date() } },
        ],
      },
    });

    const alerts: { vehicleId: string; licensePlate: string; alert: string }[] =
      [];

    for (const vehicle of vehicles) {
      if (
        vehicle.nextMaintenanceAt &&
        vehicle.nextMaintenanceAt <= new Date()
      ) {
        alerts.push({
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          alert: "Maintenance overdue",
        });
      }
      if (vehicle.insuranceExpiry && vehicle.insuranceExpiry <= new Date()) {
        alerts.push({
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          alert: "Insurance expired",
        });
      }
      if (
        vehicle.registrationExpiry &&
        vehicle.registrationExpiry <= new Date()
      ) {
        alerts.push({
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          alert: "Registration expired",
        });
      }
    }

    return alerts;
  }

  private async getVehicleEarningsBreakdown(
    fleetId: string,
    start: Date,
    end: Date
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

    return earnings.map((e: any) => ({
      vehicleId: e.vehicleId,
      licensePlate: vehicleMap.get(e.vehicleId)?.licensePlate || "Unknown",
      earnings: parseFloat(e._sum.totalEarnings || "0"),
      trips: e._sum.trips || 0,
    }));
  }

  private async getDriverEarningsBreakdown(
    fleetId: string,
    start: Date,
    end: Date
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

    return earnings.map((e: any) => ({
      driverId: e.driverId,
      name: driverMap.get(e.driverId)?.name || "Unknown",
      earnings: parseFloat(e._sum.driverShare || "0"),
      trips: e._sum.trips || 0,
    }));
  }

  // Mappers
  private mapFleetOwner(f: any): FleetOwner {
    return {
      id: f.id,
      driverId: f.driverId,
      businessName: f.businessName,
      businessType: f.businessType,
      registrationNumber: f.registrationNumber,
      taxId: f.taxId,
      address: f.address,
      city: f.city,
      status: f.status as FleetOwnerStatus,
      maxVehicles: f.maxVehicles,
      commissionRate: parseFloat(f.commissionRate),
      totalVehicles: f.totalVehicles,
      activeVehicles: f.activeVehicles,
      totalDrivers: f.totalDrivers,
      activeDrivers: f.activeDrivers,
      totalEarnings: parseFloat(f.totalEarnings),
      balance: parseFloat(f.balance),
      createdAt: f.createdAt,
    };
  }

  private mapFleetVehicle(v: any): FleetVehicle {
    return {
      id: v.id,
      fleetId: v.fleetId,
      licensePlate: v.licensePlate,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      vehicleType: v.vehicleType,
      vinNumber: v.vinNumber,
      insuranceExpiry: v.insuranceExpiry,
      registrationExpiry: v.registrationExpiry,
      status: v.status as VehicleStatus,
      assignedDriverId: v.assignedDriverId,
      assignedDriver: v.assignedDriver,
      totalTrips: v.totalTrips,
      totalEarnings: parseFloat(v.totalEarnings || "0"),
      lastTripAt: v.lastTripAt,
      lastMaintenanceAt: v.lastMaintenanceAt,
      nextMaintenanceAt: v.nextMaintenanceAt,
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
      status: d.status as FleetDriverStatus,
      commissionRate: parseFloat(d.commissionRate),
      totalTrips: d.totalTrips,
      totalEarnings: parseFloat(d.totalEarnings || "0"),
      ownerEarnings: parseFloat(d.ownerEarnings || "0"),
      invitedAt: d.invitedAt,
      joinedAt: d.joinedAt,
      leftAt: d.leftAt,
      isOnline: d.isOnline,
    };
  }

  private mapApplication(a: any): FleetApplication {
    return {
      id: a.id,
      driverId: a.driverId,
      businessName: a.businessName,
      businessType: a.businessType,
      registrationNumber: a.registrationNumber,
      taxId: a.taxId,
      address: a.address,
      city: a.city,
      vehicleCount: a.vehicleCount,
      documents: a.documents,
      status: a.status as ApplicationStatus,
      submittedAt: a.submittedAt,
      reviewedBy: a.reviewedBy,
      reviewedAt: a.reviewedAt,
      reviewNotes: a.reviewNotes,
    };
  }

  private mapMaintenance(m: any): VehicleMaintenance {
    return {
      id: m.id,
      vehicleId: m.vehicleId,
      maintenanceType: m.maintenanceType as MaintenanceType,
      description: m.description,
      scheduledDate: m.scheduledDate,
      completedAt: m.completedAt,
      estimatedCost: m.estimatedCost ? parseFloat(m.estimatedCost) : undefined,
      actualCost: m.actualCost ? parseFloat(m.actualCost) : undefined,
      serviceProvider: m.serviceProvider,
      status: m.status as MaintenanceStatus,
      notes: m.notes,
      nextServiceMileage: m.nextServiceMileage,
      nextServiceDate: m.nextServiceDate,
    };
  }

  private trackEvent(
    driverId: string,
    eventName: string,
    properties: Record<string, unknown>
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

export { FleetOwnerService };
