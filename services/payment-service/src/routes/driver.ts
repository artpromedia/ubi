/**
 * UBI Driver Experience Platform
 * API Routes (Hono)
 *
 * Comprehensive driver super-app routes covering:
 * - Earnings Dashboard
 * - Incentives & Streaks
 * - Benefits & Fuel Discounts
 * - Career Progression & Training
 * - Community & Events
 * - Fleet Management
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// const _EarningsQuerySchema = z.object({
//   period: z.enum(["day", "week", "month", "custom"]).optional(),
//   startDate: z.string().datetime().optional(),
//   endDate: z.string().datetime().optional(),
// });

const GoalSchema = z.object({
  goalType: z.enum([
    "DAILY_EARNINGS",
    "WEEKLY_EARNINGS",
    "MONTHLY_EARNINGS",
    "DAILY_TRIPS",
    "WEEKLY_TRIPS",
    "MONTHLY_TRIPS",
  ]),
  targetValue: z.number().positive(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

const BenefitEnrollmentSchema = z.object({
  packageId: z.string().uuid(),
  billingCycle: z.enum(["MONTHLY", "QUARTERLY", "ANNUALLY"]).optional(),
  autoRenew: z.boolean().optional(),
  dependents: z
    .array(
      z.object({
        name: z.string(),
        relationship: z.string(),
        dateOfBirth: z.string().datetime(),
      })
    )
    .optional(),
});

const ClaimSchema = z.object({
  enrollmentId: z.string().uuid(),
  claimType: z.string(),
  description: z.string(),
  amount: z.number().positive(),
  documents: z.array(z.string()),
  incidentDate: z.string().datetime(),
});

const FuelTransactionSchema = z.object({
  stationId: z.string().uuid(),
  stationName: z.string(),
  liters: z.number().positive(),
  pricePerLiter: z.number().positive(),
  originalAmount: z.number().positive(),
  discountAmount: z.number(),
  finalAmount: z.number().positive(),
  currency: z.string().default("NGN"),
});

const TrainingProgressSchema = z.object({
  progress: z.number().min(0).max(100),
  lessonId: z.string().optional(),
});

const TrainingCompleteSchema = z.object({
  quizScore: z.number().min(0).max(100).optional(),
});

const ForumPostSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().min(5).max(200),
  content: z.string().min(10).max(10000),
  postType: z
    .enum(["DISCUSSION", "QUESTION", "TIP", "ANNOUNCEMENT", "POLL"])
    .optional(),
  images: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const CommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().uuid().optional(),
});

const EventSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(5000),
  eventType: z.enum([
    "MEETUP",
    "TRAINING",
    "CELEBRATION",
    "TOWN_HALL",
    "WORKSHOP",
    "COMMUNITY_SERVICE",
  ]),
  eventDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  venue: z.string(),
  address: z.string(),
  city: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  maxAttendees: z.number().positive().optional(),
  imageUrl: z.string().url().optional(),
  isVirtual: z.boolean().optional(),
  virtualLink: z.string().url().optional(),
  agenda: z.array(z.string()).optional(),
  perks: z.array(z.string()).optional(),
});

const FleetApplicationSchema = z.object({
  businessName: z.string().min(2).max(200),
  businessType: z.enum([
    "SOLE_PROPRIETOR",
    "PARTNERSHIP",
    "LIMITED_COMPANY",
    "COOPERATIVE",
  ]),
  registrationNumber: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string(),
  city: z.string(),
  vehicleCount: z.number().positive(),
  documents: z.array(z.string()),
});

const FleetVehicleSchema = z.object({
  licensePlate: z.string().min(3).max(20),
  make: z.string(),
  model: z.string(),
  year: z
    .number()
    .min(2000)
    .max(new Date().getFullYear() + 1),
  color: z.string(),
  vehicleType: z.enum([
    "SEDAN",
    "SUV",
    "MINIVAN",
    "MOTORCYCLE",
    "TRICYCLE",
    "BICYCLE",
    "ELECTRIC",
  ]),
  vinNumber: z.string().optional(),
  insuranceExpiry: z.string().datetime(),
  registrationExpiry: z.string().datetime(),
});

const MaintenanceSchema = z.object({
  maintenanceType: z.enum([
    "OIL_CHANGE",
    "TIRE_ROTATION",
    "BRAKE_SERVICE",
    "BATTERY",
    "AC_SERVICE",
    "FULL_SERVICE",
    "INSPECTION",
    "REPAIR",
    "OTHER",
  ]),
  description: z.string(),
  scheduledDate: z.string().datetime(),
  estimatedCost: z.number().positive().optional(),
  serviceProvider: z.string().optional(),
});

// =============================================================================
// TYPES
// =============================================================================

type Variables = {
  driver: { id: string };
};

// =============================================================================
// CREATE DRIVER ROUTES
// =============================================================================

export function createDriverRoutes(services: {
  earningsService: any;
  goalsService: any;
  incentiveService: any;
  benefitsService: any;
  careerService: any;
  trainingService: any;
  communityService: any;
  fleetService: any;
  demandService?: any;
}): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  // =============================================================================
  // EARNINGS ROUTES
  // =============================================================================

  app.get("/earnings/today", async (c) => {
    const driverId = c.get("driver").id;
    const earnings = await services.earningsService.getTodayEarnings(driverId);
    return c.json({ success: true, data: earnings });
  });

  app.get("/earnings/history", async (c) => {
    const driverId = c.get("driver").id;
    const period = c.req.query("period") || "week";
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");

    const earnings = await services.earningsService.getEarningsHistory(
      driverId,
      period,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
    return c.json({ success: true, data: earnings });
  });

  app.get("/earnings/suggestions", async (c) => {
    const driverId = c.get("driver").id;
    const suggestions =
      await services.earningsService.getEarningsSuggestions(driverId);
    return c.json({ success: true, data: suggestions });
  });

  app.get("/earnings/projection", async (c) => {
    const driverId = c.get("driver").id;
    const projection =
      await services.earningsService.calculateEarningsProjection(driverId);
    return c.json({ success: true, data: projection });
  });

  // =============================================================================
  // GOALS ROUTES
  // =============================================================================

  app.get("/goals", async (c) => {
    const driverId = c.get("driver").id;
    const goals = await services.goalsService.getDriverGoals(driverId);
    return c.json({ success: true, data: goals });
  });

  app.post("/goals", zValidator("json", GoalSchema), async (c) => {
    const driverId = c.get("driver").id;
    const body = c.req.valid("json");
    const goal = await services.goalsService.createGoal(driverId, {
      ...body,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
    return c.json({ success: true, data: goal }, 201);
  });

  app.delete("/goals/:goalId", async (c) => {
    const driverId = c.get("driver").id;
    const goalId = c.req.param("goalId");
    await services.goalsService.deleteGoal(driverId, goalId);
    return c.json({ success: true, message: "Goal deleted" });
  });

  // =============================================================================
  // INCENTIVES ROUTES
  // =============================================================================

  app.get("/incentives", async (c) => {
    const driverId = c.get("driver").id;
    const incentives =
      await services.incentiveService.getAvailableIncentives(driverId);
    return c.json({ success: true, data: incentives });
  });

  app.get("/streaks", async (c) => {
    const driverId = c.get("driver").id;
    const streaks = await services.incentiveService.getActiveStreaks(driverId);
    return c.json({ success: true, data: streaks });
  });

  // =============================================================================
  // BENEFITS ROUTES
  // =============================================================================

  app.get("/benefits", async (c) => {
    const driverId = c.get("driver").id;
    const benefits =
      await services.benefitsService.getAvailableBenefits(driverId);
    return c.json({ success: true, data: benefits });
  });

  app.get("/benefits/enrollments", async (c) => {
    const driverId = c.get("driver").id;
    const enrollments = await services.benefitsService.getEnrollments(driverId);
    return c.json({ success: true, data: enrollments });
  });

  app.post(
    "/benefits/enroll",
    zValidator("json", BenefitEnrollmentSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const body = c.req.valid("json");
      const enrollment = await services.benefitsService.enrollInBenefit(
        driverId,
        body.packageId,
        {
          billingCycle: body.billingCycle,
          autoRenew: body.autoRenew,
          dependents: body.dependents,
        }
      );
      return c.json({ success: true, data: enrollment }, 201);
    }
  );

  app.delete("/benefits/enrollments/:enrollmentId", async (c) => {
    const driverId = c.get("driver").id;
    const enrollmentId = c.req.param("enrollmentId");
    await services.benefitsService.cancelEnrollment(driverId, enrollmentId);
    return c.json({ success: true, message: "Enrollment cancelled" });
  });

  app.post("/benefits/claims", zValidator("json", ClaimSchema), async (c) => {
    const driverId = c.get("driver").id;
    const body = c.req.valid("json");
    const claim = await services.benefitsService.submitClaim(
      driverId,
      body.enrollmentId,
      {
        ...body,
        incidentDate: new Date(body.incidentDate),
      }
    );
    return c.json({ success: true, data: claim }, 201);
  });

  app.get("/benefits/claims", async (c) => {
    const driverId = c.get("driver").id;
    const claims = await services.benefitsService.getClaims(driverId);
    return c.json({ success: true, data: claims });
  });

  // =============================================================================
  // FUEL DISCOUNT ROUTES
  // =============================================================================

  app.get("/fuel/discount", async (c) => {
    const driverId = c.get("driver").id;
    const discount = await services.benefitsService.getFuelDiscount(driverId);
    return c.json({ success: true, data: discount });
  });

  app.get("/fuel/stations", async (c) => {
    const latitude = Number.parseFloat(c.req.query("latitude") || "0");
    const longitude = Number.parseFloat(c.req.query("longitude") || "0");
    const radius = c.req.query("radius")
      ? Number.parseFloat(c.req.query("radius")!)
      : undefined;
    const stations = await services.benefitsService.getNearbyFuelStations(
      latitude,
      longitude,
      radius
    );
    return c.json({ success: true, data: stations });
  });

  app.post(
    "/fuel/transactions",
    zValidator("json", FuelTransactionSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const body = c.req.valid("json");
      const transaction = await services.benefitsService.recordFuelTransaction(
        driverId,
        { ...body, transactedAt: new Date() }
      );
      return c.json({ success: true, data: transaction }, 201);
    }
  );

  app.get("/fuel/transactions", async (c) => {
    const driverId = c.get("driver").id;
    const limit = Number.parseInt(c.req.query("limit") || "20");
    const transactions = await services.benefitsService.getFuelTransactions(
      driverId,
      limit
    );
    return c.json({ success: true, data: transactions });
  });

  // =============================================================================
  // CAREER ROUTES
  // =============================================================================

  app.get("/profile", async (c) => {
    const driverId = c.get("driver").id;
    const profile = await services.careerService.getDriverProfile(driverId);
    return c.json({ success: true, data: profile });
  });

  app.get("/tier/progress", async (c) => {
    const driverId = c.get("driver").id;
    const progress = await services.careerService.getTierProgress(driverId);
    return c.json({ success: true, data: progress });
  });

  app.get("/tier/history", async (c) => {
    const driverId = c.get("driver").id;
    const history = await services.careerService.getTierHistory(driverId);
    return c.json({ success: true, data: history });
  });

  app.get("/badges", async (c) => {
    const driverId = c.get("driver").id;
    const badges = await services.careerService.getDriverBadges(driverId);
    return c.json({ success: true, data: badges });
  });

  // =============================================================================
  // TRAINING ROUTES
  // =============================================================================

  app.get("/training/modules", async (c) => {
    const driverId = c.get("driver").id;
    const category = c.req.query("category");
    const modules = await services.trainingService.getTrainingModules(
      driverId,
      category
    );
    return c.json({ success: true, data: modules });
  });

  app.get("/training/recommended", async (c) => {
    const driverId = c.get("driver").id;
    const modules =
      await services.trainingService.getRecommendedModules(driverId);
    return c.json({ success: true, data: modules });
  });

  app.post("/training/modules/:moduleId/start", async (c) => {
    const driverId = c.get("driver").id;
    const moduleId = c.req.param("moduleId");
    const completion = await services.trainingService.startModule(
      driverId,
      moduleId
    );
    return c.json({ success: true, data: completion }, 201);
  });

  app.patch(
    "/training/modules/:moduleId/progress",
    zValidator("json", TrainingProgressSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const moduleId = c.req.param("moduleId");
      const body = c.req.valid("json");
      const completion = await services.trainingService.updateProgress(
        driverId,
        moduleId,
        body.progress,
        body.lessonId
      );
      return c.json({ success: true, data: completion });
    }
  );

  app.post(
    "/training/modules/:moduleId/complete",
    zValidator("json", TrainingCompleteSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const moduleId = c.req.param("moduleId");
      const body = c.req.valid("json");
      const completion = await services.trainingService.completeModule(
        driverId,
        moduleId,
        body.quizScore
      );
      return c.json({ success: true, data: completion });
    }
  );

  app.get("/training/completions", async (c) => {
    const driverId = c.get("driver").id;
    const completions =
      await services.trainingService.getDriverCompletions(driverId);
    return c.json({ success: true, data: completions });
  });

  app.get("/certifications", async (c) => {
    const driverId = c.get("driver").id;
    const certifications =
      await services.trainingService.getCertifications(driverId);
    return c.json({ success: true, data: certifications });
  });

  // =============================================================================
  // COMMUNITY ROUTES - FORUM
  // =============================================================================

  app.get("/forum/categories", async (c) => {
    const categories = await services.communityService.getForumCategories();
    return c.json({ success: true, data: categories });
  });

  app.get("/forum/posts", async (c) => {
    const categoryId = c.req.query("categoryId");
    const page = Number.parseInt(c.req.query("page") || "1");
    const limit = Number.parseInt(c.req.query("limit") || "20");
    const result = await services.communityService.getForumPosts(
      categoryId as string,
      page,
      limit
    );
    return c.json({ success: true, data: result });
  });

  app.get("/forum/posts/:postId", async (c) => {
    const postId = c.req.param("postId");
    const post = await services.communityService.getPostDetails(postId);
    if (!post) {
      return c.json({ success: false, error: "Post not found" }, 404);
    }
    return c.json({ success: true, data: post });
  });

  app.post("/forum/posts", zValidator("json", ForumPostSchema), async (c) => {
    const driverId = c.get("driver").id;
    const body = c.req.valid("json");
    const post = await services.communityService.createPost(
      driverId,
      body.categoryId,
      body
    );
    return c.json({ success: true, data: post }, 201);
  });

  app.delete("/forum/posts/:postId", async (c) => {
    const driverId = c.get("driver").id;
    const postId = c.req.param("postId");
    await services.communityService.deletePost(driverId, postId);
    return c.json({ success: true, message: "Post deleted" });
  });

  app.post("/forum/posts/:postId/like", async (c) => {
    const driverId = c.get("driver").id;
    const postId = c.req.param("postId");
    const liked = await services.communityService.likePost(driverId, postId);
    return c.json({ success: true, data: { liked } });
  });

  app.get("/forum/posts/:postId/comments", async (c) => {
    const postId = c.req.param("postId");
    const page = Number.parseInt(c.req.query("page") || "1");
    const limit = Number.parseInt(c.req.query("limit") || "50");
    const result = await services.communityService.getPostComments(
      postId,
      page,
      limit
    );
    return c.json({ success: true, data: result });
  });

  app.post(
    "/forum/posts/:postId/comments",
    zValidator("json", CommentSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const postId = c.req.param("postId");
      const body = c.req.valid("json");
      const comment = await services.communityService.addComment(
        driverId,
        postId,
        body.content,
        body.parentId
      );
      return c.json({ success: true, data: comment }, 201);
    }
  );

  // =============================================================================
  // COMMUNITY ROUTES - EVENTS
  // =============================================================================

  app.get("/events", async (c) => {
    const city = c.req.query("city");
    const limit = Number.parseInt(c.req.query("limit") || "10");
    const events = await services.communityService.getUpcomingEvents(
      city as string,
      limit
    );
    return c.json({ success: true, data: events });
  });

  app.get("/events/:eventId", async (c) => {
    const eventId = c.req.param("eventId");
    const event = await services.communityService.getEventDetails(eventId);
    if (!event) {
      return c.json({ success: false, error: "Event not found" }, 404);
    }
    return c.json({ success: true, data: event });
  });

  app.post("/events", zValidator("json", EventSchema), async (c) => {
    const driverId = c.get("driver").id;
    const body = c.req.valid("json");
    const event = await services.communityService.createEvent(driverId, {
      ...body,
      eventDate: new Date(body.eventDate),
      endDate: body.endDate ? new Date(body.endDate) : undefined,
    });
    return c.json({ success: true, data: event }, 201);
  });

  app.post("/events/:eventId/register", async (c) => {
    const driverId = c.get("driver").id;
    const eventId = c.req.param("eventId");
    const registration = await services.communityService.registerForEvent(
      driverId,
      eventId
    );
    return c.json({ success: true, data: registration }, 201);
  });

  app.delete("/events/:eventId/register", async (c) => {
    const driverId = c.get("driver").id;
    const eventId = c.req.param("eventId");
    await services.communityService.cancelRegistration(driverId, eventId);
    return c.json({ success: true, message: "Registration cancelled" });
  });

  app.get("/events/my-registrations", async (c) => {
    const driverId = c.get("driver").id;
    const registrations =
      await services.communityService.getMyRegistrations(driverId);
    return c.json({ success: true, data: registrations });
  });

  // =============================================================================
  // MENTORSHIP ROUTES
  // =============================================================================

  app.post("/mentorship/apply", async (c) => {
    const driverId = c.get("driver").id;
    const mentorship =
      await services.communityService.applyForMentorship(driverId);
    return c.json({ success: true, data: mentorship }, 201);
  });

  app.post("/mentorship/become-mentor", async (c) => {
    const driverId = c.get("driver").id;
    await services.communityService.becomeMentor(driverId);
    return c.json({ success: true, message: "You are now a mentor" });
  });

  app.get("/mentorship/status", async (c) => {
    const driverId = c.get("driver").id;
    const status =
      await services.communityService.getMentorshipStatus(driverId);
    return c.json({ success: true, data: status });
  });

  // =============================================================================
  // LEADERBOARD ROUTES
  // =============================================================================

  app.get("/leaderboard", async (c) => {
    const type = c.req.query("type") || "trips";
    const period = c.req.query("period") || "MONTHLY";
    const city = c.req.query("city");
    const limit = Number.parseInt(c.req.query("limit") || "100");
    const leaderboard = await services.communityService.getLeaderboard(
      type,
      period,
      city as string,
      limit
    );
    return c.json({ success: true, data: leaderboard });
  });

  app.get("/leaderboard/my-rank", async (c) => {
    const driverId = c.get("driver").id;
    const type = c.req.query("type") || "trips";
    const period = c.req.query("period") || "MONTHLY";
    const ranking = await services.communityService.getDriverRanking(
      driverId,
      type,
      period
    );
    return c.json({ success: true, data: ranking });
  });

  // =============================================================================
  // FLEET ROUTES
  // =============================================================================

  app.post(
    "/fleet/apply",
    zValidator("json", FleetApplicationSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const body = c.req.valid("json");
      const application = await services.fleetService.applyForFleetOwner(
        driverId,
        body
      );
      return c.json({ success: true, data: application }, 201);
    }
  );

  app.get("/fleet/application", async (c) => {
    const driverId = c.get("driver").id;
    const application =
      await services.fleetService.getApplicationStatus(driverId);
    return c.json({ success: true, data: application });
  });

  app.get("/fleet/profile", async (c) => {
    const driverId = c.get("driver").id;
    const fleet = await services.fleetService.getFleetOwner(driverId);
    return c.json({ success: true, data: fleet });
  });

  app.get("/fleet/dashboard", async (c) => {
    const driverId = c.get("driver").id;
    const dashboard = await services.fleetService.getFleetDashboard(driverId);
    return c.json({ success: true, data: dashboard });
  });

  app.get("/fleet/vehicles", async (c) => {
    const driverId = c.get("driver").id;
    const vehicles = await services.fleetService.getVehicles(driverId);
    return c.json({ success: true, data: vehicles });
  });

  app.post(
    "/fleet/vehicles",
    zValidator("json", FleetVehicleSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const body = c.req.valid("json");
      const vehicle = await services.fleetService.addVehicle(driverId, {
        ...body,
        insuranceExpiry: new Date(body.insuranceExpiry),
        registrationExpiry: new Date(body.registrationExpiry),
      });
      return c.json({ success: true, data: vehicle }, 201);
    }
  );

  app.patch("/fleet/vehicles/:vehicleId", async (c) => {
    const driverId = c.get("driver").id;
    const vehicleId = c.req.param("vehicleId");
    const body = await c.req.json();
    const vehicle = await services.fleetService.updateVehicle(
      driverId,
      vehicleId,
      body
    );
    return c.json({ success: true, data: vehicle });
  });

  app.delete("/fleet/vehicles/:vehicleId", async (c) => {
    const driverId = c.get("driver").id;
    const vehicleId = c.req.param("vehicleId");
    await services.fleetService.removeVehicle(driverId, vehicleId);
    return c.json({ success: true, message: "Vehicle removed" });
  });

  app.get("/fleet/drivers", async (c) => {
    const driverId = c.get("driver").id;
    const drivers = await services.fleetService.getFleetDrivers(driverId);
    return c.json({ success: true, data: drivers });
  });

  app.post("/fleet/drivers/invite", async (c) => {
    const fleetOwnerId = c.get("driver").id;
    const body = await c.req.json();
    const invitation = await services.fleetService.inviteDriver(
      fleetOwnerId,
      body.driverId,
      body.vehicleId
    );
    return c.json({ success: true, data: invitation }, 201);
  });

  app.post("/fleet/invitations/:invitationId/respond", async (c) => {
    const driverId = c.get("driver").id;
    const invitationId = c.req.param("invitationId");
    const body = await c.req.json();
    const result = await services.fleetService.respondToInvitation(
      driverId,
      invitationId,
      body.accept
    );
    return c.json({ success: true, data: result });
  });

  app.post("/fleet/drivers/:targetDriverId/assign-vehicle", async (c) => {
    const fleetOwnerId = c.get("driver").id;
    const targetDriverId = c.req.param("targetDriverId");
    const body = await c.req.json();
    await services.fleetService.assignVehicleToDriver(
      fleetOwnerId,
      targetDriverId,
      body.vehicleId
    );
    return c.json({ success: true, message: "Vehicle assigned" });
  });

  app.delete("/fleet/drivers/:targetDriverId", async (c) => {
    const fleetOwnerId = c.get("driver").id;
    const targetDriverId = c.req.param("targetDriverId");
    await services.fleetService.removeDriverFromFleet(
      fleetOwnerId,
      targetDriverId
    );
    return c.json({ success: true, message: "Driver removed from fleet" });
  });

  app.get("/fleet/earnings", async (c) => {
    const driverId = c.get("driver").id;
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const earnings = await services.fleetService.getFleetEarnings(
      driverId,
      new Date(startDate!),
      new Date(endDate!)
    );
    return c.json({ success: true, data: earnings });
  });

  app.post("/fleet/payout", async (c) => {
    const driverId = c.get("driver").id;
    const body = await c.req.json();
    await services.fleetService.requestPayout(driverId, body.amount);
    return c.json({ success: true, message: "Payout processed" });
  });

  app.post(
    "/fleet/vehicles/:vehicleId/maintenance",
    zValidator("json", MaintenanceSchema),
    async (c) => {
      const driverId = c.get("driver").id;
      const vehicleId = c.req.param("vehicleId");
      const body = c.req.valid("json");
      const maintenance = await services.fleetService.scheduleMaintenance(
        driverId,
        vehicleId,
        {
          ...body,
          scheduledDate: new Date(body.scheduledDate),
        }
      );
      return c.json({ success: true, data: maintenance }, 201);
    }
  );

  app.get("/fleet/maintenance", async (c) => {
    const driverId = c.get("driver").id;
    const vehicleId = c.req.query("vehicleId");
    const history = await services.fleetService.getMaintenanceHistory(
      driverId,
      vehicleId as string
    );
    return c.json({ success: true, data: history });
  });

  // =============================================================================
  // DEMAND / GUIDANCE ROUTES
  // =============================================================================

  app.get("/demand/heatmap", async (c) => {
    const city = c.req.query("city");
    const latitude = c.req.query("latitude")
      ? Number.parseFloat(c.req.query("latitude")!)
      : undefined;
    const longitude = c.req.query("longitude")
      ? Number.parseFloat(c.req.query("longitude")!)
      : undefined;
    const heatmap = await services.demandService?.getDemandHeatmap(
      city as string,
      latitude,
      longitude
    );
    return c.json({ success: true, data: heatmap });
  });

  app.get("/guidance", async (c) => {
    const driverId = c.get("driver").id;
    const latitude = Number.parseFloat(c.req.query("latitude") || "0");
    const longitude = Number.parseFloat(c.req.query("longitude") || "0");
    const guidance = await services.demandService?.getDriverGuidance(
      driverId,
      latitude,
      longitude
    );
    return c.json({ success: true, data: guidance });
  });

  return app;
}

export { createDriverRoutes as driverRoutes };
export default createDriverRoutes;
