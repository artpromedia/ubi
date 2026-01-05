// ===========================================
// UBI Driver Experience Platform
// API Routes & Controllers
// ===========================================

import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";

// -----------------------------------------
// VALIDATION SCHEMAS
// -----------------------------------------

const EarningsQuerySchema = z.object({
  period: z.enum(["day", "week", "month", "custom"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

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

// -----------------------------------------
// HELPER MIDDLEWARE
// -----------------------------------------

function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "Validation error",
          details: error.errors,
        });
      } else {
        next(error);
      }
    }
  };
}

function validateQuery(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "Validation error",
          details: error.errors,
        });
      } else {
        next(error);
      }
    }
  };
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// -----------------------------------------
// CREATE DRIVER ROUTES
// -----------------------------------------

export function createDriverExperienceRoutes(services: {
  earningsService: any;
  goalsService: any;
  incentiveService: any;
  benefitsService: any;
  careerService: any;
  trainingService: any;
  communityService: any;
  fleetService: any;
  demandService: any;
}): Router {
  const router = Router();

  // -----------------------------------------
  // EARNINGS ROUTES
  // -----------------------------------------

  router.get(
    "/earnings/today",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const earnings =
        await services.earningsService.getTodayEarnings(driverId);
      res.json({ success: true, data: earnings });
    })
  );

  router.get(
    "/earnings/history",
    validateQuery(EarningsQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const { period, startDate, endDate } = req.query as any;
      const earnings = await services.earningsService.getEarningsHistory(
        driverId,
        period || "week",
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined
      );
      res.json({ success: true, data: earnings });
    })
  );

  router.get(
    "/earnings/suggestions",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const suggestions =
        await services.earningsService.getEarningsSuggestions(driverId);
      res.json({ success: true, data: suggestions });
    })
  );

  router.get(
    "/earnings/projection",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const projection =
        await services.earningsService.calculateEarningsProjection(driverId);
      res.json({ success: true, data: projection });
    })
  );

  // -----------------------------------------
  // GOALS ROUTES
  // -----------------------------------------

  router.get(
    "/goals",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const goals = await services.goalsService.getDriverGoals(driverId);
      res.json({ success: true, data: goals });
    })
  );

  router.post(
    "/goals",
    validateBody(GoalSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const goal = await services.goalsService.createGoal(driverId, {
        ...req.body,
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate),
      });
      res.status(201).json({ success: true, data: goal });
    })
  );

  router.delete(
    "/goals/:goalId",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      await services.goalsService.deleteGoal(driverId, req.params.goalId);
      res.json({ success: true, message: "Goal deleted" });
    })
  );

  // -----------------------------------------
  // INCENTIVES ROUTES
  // -----------------------------------------

  router.get(
    "/incentives",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const incentives =
        await services.incentiveService.getAvailableIncentives(driverId);
      res.json({ success: true, data: incentives });
    })
  );

  router.get(
    "/streaks",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const streaks =
        await services.incentiveService.getActiveStreaks(driverId);
      res.json({ success: true, data: streaks });
    })
  );

  // -----------------------------------------
  // BENEFITS ROUTES
  // -----------------------------------------

  router.get(
    "/benefits",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const benefits =
        await services.benefitsService.getAvailableBenefits(driverId);
      res.json({ success: true, data: benefits });
    })
  );

  router.get(
    "/benefits/enrollments",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const enrollments =
        await services.benefitsService.getEnrollments(driverId);
      res.json({ success: true, data: enrollments });
    })
  );

  router.post(
    "/benefits/enroll",
    validateBody(BenefitEnrollmentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const enrollment = await services.benefitsService.enrollInBenefit(
        driverId,
        req.body.packageId,
        {
          billingCycle: req.body.billingCycle,
          autoRenew: req.body.autoRenew,
          dependents: req.body.dependents,
        }
      );
      res.status(201).json({ success: true, data: enrollment });
    })
  );

  router.delete(
    "/benefits/enrollments/:enrollmentId",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      await services.benefitsService.cancelEnrollment(
        driverId,
        req.params.enrollmentId
      );
      res.json({ success: true, message: "Enrollment cancelled" });
    })
  );

  router.post(
    "/benefits/claims",
    validateBody(ClaimSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const claim = await services.benefitsService.submitClaim(
        driverId,
        req.body.enrollmentId,
        {
          ...req.body,
          incidentDate: new Date(req.body.incidentDate),
        }
      );
      res.status(201).json({ success: true, data: claim });
    })
  );

  router.get(
    "/benefits/claims",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const claims = await services.benefitsService.getClaims(driverId);
      res.json({ success: true, data: claims });
    })
  );

  // -----------------------------------------
  // FUEL DISCOUNT ROUTES
  // -----------------------------------------

  router.get(
    "/fuel/discount",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const discount = await services.benefitsService.getFuelDiscount(driverId);
      res.json({ success: true, data: discount });
    })
  );

  router.get(
    "/fuel/stations",
    asyncHandler(async (req: Request, res: Response) => {
      const { latitude, longitude, radius } = req.query;
      const stations = await services.benefitsService.getNearbyFuelStations(
        parseFloat(latitude as string),
        parseFloat(longitude as string),
        radius ? parseFloat(radius as string) : undefined
      );
      res.json({ success: true, data: stations });
    })
  );

  router.post(
    "/fuel/transactions",
    validateBody(FuelTransactionSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const transaction = await services.benefitsService.recordFuelTransaction(
        driverId,
        { ...req.body, transactedAt: new Date() }
      );
      res.status(201).json({ success: true, data: transaction });
    })
  );

  router.get(
    "/fuel/transactions",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const transactions = await services.benefitsService.getFuelTransactions(
        driverId,
        limit
      );
      res.json({ success: true, data: transactions });
    })
  );

  // -----------------------------------------
  // CAREER ROUTES
  // -----------------------------------------

  router.get(
    "/profile",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const profile = await services.careerService.getDriverProfile(driverId);
      res.json({ success: true, data: profile });
    })
  );

  router.get(
    "/tier/progress",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const progress = await services.careerService.getTierProgress(driverId);
      res.json({ success: true, data: progress });
    })
  );

  router.get(
    "/tier/history",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const history = await services.careerService.getTierHistory(driverId);
      res.json({ success: true, data: history });
    })
  );

  router.get(
    "/badges",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const badges = await services.careerService.getDriverBadges(driverId);
      res.json({ success: true, data: badges });
    })
  );

  // -----------------------------------------
  // TRAINING ROUTES
  // -----------------------------------------

  router.get(
    "/training/modules",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const category = req.query.category as string | undefined;
      const modules = await services.trainingService.getTrainingModules(
        driverId,
        category
      );
      res.json({ success: true, data: modules });
    })
  );

  router.get(
    "/training/recommended",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const modules =
        await services.trainingService.getRecommendedModules(driverId);
      res.json({ success: true, data: modules });
    })
  );

  router.post(
    "/training/modules/:moduleId/start",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const completion = await services.trainingService.startModule(
        driverId,
        req.params.moduleId
      );
      res.status(201).json({ success: true, data: completion });
    })
  );

  router.patch(
    "/training/modules/:moduleId/progress",
    validateBody(TrainingProgressSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const completion = await services.trainingService.updateProgress(
        driverId,
        req.params.moduleId,
        req.body.progress,
        req.body.lessonId
      );
      res.json({ success: true, data: completion });
    })
  );

  router.post(
    "/training/modules/:moduleId/complete",
    validateBody(TrainingCompleteSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const completion = await services.trainingService.completeModule(
        driverId,
        req.params.moduleId,
        req.body.quizScore
      );
      res.json({ success: true, data: completion });
    })
  );

  router.get(
    "/training/completions",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const completions =
        await services.trainingService.getDriverCompletions(driverId);
      res.json({ success: true, data: completions });
    })
  );

  router.get(
    "/certifications",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const certifications =
        await services.trainingService.getCertifications(driverId);
      res.json({ success: true, data: certifications });
    })
  );

  // -----------------------------------------
  // COMMUNITY ROUTES
  // -----------------------------------------

  router.get(
    "/forum/categories",
    asyncHandler(async (req: Request, res: Response) => {
      const categories = await services.communityService.getForumCategories();
      res.json({ success: true, data: categories });
    })
  );

  router.get(
    "/forum/posts",
    asyncHandler(async (req: Request, res: Response) => {
      const { categoryId, page, limit } = req.query;
      const result = await services.communityService.getForumPosts(
        categoryId as string,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20
      );
      res.json({ success: true, data: result });
    })
  );

  router.get(
    "/forum/posts/:postId",
    asyncHandler(async (req: Request, res: Response) => {
      const post = await services.communityService.getPostDetails(
        req.params.postId
      );
      if (!post) {
        res.status(404).json({ success: false, error: "Post not found" });
        return;
      }
      res.json({ success: true, data: post });
    })
  );

  router.post(
    "/forum/posts",
    validateBody(ForumPostSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const post = await services.communityService.createPost(
        driverId,
        req.body.categoryId,
        req.body
      );
      res.status(201).json({ success: true, data: post });
    })
  );

  router.delete(
    "/forum/posts/:postId",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      await services.communityService.deletePost(driverId, req.params.postId);
      res.json({ success: true, message: "Post deleted" });
    })
  );

  router.post(
    "/forum/posts/:postId/like",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const liked = await services.communityService.likePost(
        driverId,
        req.params.postId
      );
      res.json({ success: true, data: { liked } });
    })
  );

  router.get(
    "/forum/posts/:postId/comments",
    asyncHandler(async (req: Request, res: Response) => {
      const { page, limit } = req.query;
      const result = await services.communityService.getPostComments(
        req.params.postId,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 50
      );
      res.json({ success: true, data: result });
    })
  );

  router.post(
    "/forum/posts/:postId/comments",
    validateBody(CommentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const comment = await services.communityService.addComment(
        driverId,
        req.params.postId,
        req.body.content,
        req.body.parentId
      );
      res.status(201).json({ success: true, data: comment });
    })
  );

  // -----------------------------------------
  // EVENTS ROUTES
  // -----------------------------------------

  router.get(
    "/events",
    asyncHandler(async (req: Request, res: Response) => {
      const { city, limit } = req.query;
      const events = await services.communityService.getUpcomingEvents(
        city as string,
        limit ? parseInt(limit as string) : 10
      );
      res.json({ success: true, data: events });
    })
  );

  router.get(
    "/events/:eventId",
    asyncHandler(async (req: Request, res: Response) => {
      const event = await services.communityService.getEventDetails(
        req.params.eventId
      );
      if (!event) {
        res.status(404).json({ success: false, error: "Event not found" });
        return;
      }
      res.json({ success: true, data: event });
    })
  );

  router.post(
    "/events",
    validateBody(EventSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const event = await services.communityService.createEvent(driverId, {
        ...req.body,
        eventDate: new Date(req.body.eventDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      });
      res.status(201).json({ success: true, data: event });
    })
  );

  router.post(
    "/events/:eventId/register",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const registration = await services.communityService.registerForEvent(
        driverId,
        req.params.eventId
      );
      res.status(201).json({ success: true, data: registration });
    })
  );

  router.delete(
    "/events/:eventId/register",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      await services.communityService.cancelRegistration(
        driverId,
        req.params.eventId
      );
      res.json({ success: true, message: "Registration cancelled" });
    })
  );

  router.get(
    "/events/my-registrations",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const registrations =
        await services.communityService.getMyRegistrations(driverId);
      res.json({ success: true, data: registrations });
    })
  );

  // -----------------------------------------
  // MENTORSHIP ROUTES
  // -----------------------------------------

  router.post(
    "/mentorship/apply",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const mentorship =
        await services.communityService.applyForMentorship(driverId);
      res.status(201).json({ success: true, data: mentorship });
    })
  );

  router.post(
    "/mentorship/become-mentor",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      await services.communityService.becomeMentor(driverId);
      res.json({ success: true, message: "You are now a mentor" });
    })
  );

  router.get(
    "/mentorship/status",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const status =
        await services.communityService.getMentorshipStatus(driverId);
      res.json({ success: true, data: status });
    })
  );

  // -----------------------------------------
  // LEADERBOARD ROUTES
  // -----------------------------------------

  router.get(
    "/leaderboard",
    asyncHandler(async (req: Request, res: Response) => {
      const { type, period, city, limit } = req.query;
      const leaderboard = await services.communityService.getLeaderboard(
        (type as string) || "trips",
        (period as string) || "MONTHLY",
        city as string,
        limit ? parseInt(limit as string) : 100
      );
      res.json({ success: true, data: leaderboard });
    })
  );

  router.get(
    "/leaderboard/my-rank",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const { type, period } = req.query;
      const ranking = await services.communityService.getDriverRanking(
        driverId,
        (type as string) || "trips",
        (period as string) || "MONTHLY"
      );
      res.json({ success: true, data: ranking });
    })
  );

  // -----------------------------------------
  // FLEET ROUTES
  // -----------------------------------------

  router.post(
    "/fleet/apply",
    validateBody(FleetApplicationSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const application = await services.fleetService.applyForFleetOwner(
        driverId,
        req.body
      );
      res.status(201).json({ success: true, data: application });
    })
  );

  router.get(
    "/fleet/application",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const application =
        await services.fleetService.getApplicationStatus(driverId);
      res.json({ success: true, data: application });
    })
  );

  router.get(
    "/fleet/profile",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const fleet = await services.fleetService.getFleetOwner(driverId);
      res.json({ success: true, data: fleet });
    })
  );

  router.get(
    "/fleet/dashboard",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const dashboard = await services.fleetService.getFleetDashboard(driverId);
      res.json({ success: true, data: dashboard });
    })
  );

  router.get(
    "/fleet/vehicles",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const vehicles = await services.fleetService.getVehicles(driverId);
      res.json({ success: true, data: vehicles });
    })
  );

  router.post(
    "/fleet/vehicles",
    validateBody(FleetVehicleSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const vehicle = await services.fleetService.addVehicle(driverId, {
        ...req.body,
        insuranceExpiry: new Date(req.body.insuranceExpiry),
        registrationExpiry: new Date(req.body.registrationExpiry),
      });
      res.status(201).json({ success: true, data: vehicle });
    })
  );

  router.patch(
    "/fleet/vehicles/:vehicleId",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const vehicle = await services.fleetService.updateVehicle(
        driverId,
        req.params.vehicleId,
        req.body
      );
      res.json({ success: true, data: vehicle });
    })
  );

  router.delete(
    "/fleet/vehicles/:vehicleId",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      await services.fleetService.removeVehicle(driverId, req.params.vehicleId);
      res.json({ success: true, message: "Vehicle removed" });
    })
  );

  router.get(
    "/fleet/drivers",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const drivers = await services.fleetService.getFleetDrivers(driverId);
      res.json({ success: true, data: drivers });
    })
  );

  router.post(
    "/fleet/drivers/invite",
    asyncHandler(async (req: Request, res: Response) => {
      const fleetOwnerId = (req as any).driver.id;
      const { driverId, vehicleId } = req.body;
      const invitation = await services.fleetService.inviteDriver(
        fleetOwnerId,
        driverId,
        vehicleId
      );
      res.status(201).json({ success: true, data: invitation });
    })
  );

  router.post(
    "/fleet/invitations/:invitationId/respond",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const { accept } = req.body;
      const result = await services.fleetService.respondToInvitation(
        driverId,
        req.params.invitationId,
        accept
      );
      res.json({ success: true, data: result });
    })
  );

  router.post(
    "/fleet/drivers/:driverId/assign-vehicle",
    asyncHandler(async (req: Request, res: Response) => {
      const fleetOwnerId = (req as any).driver.id;
      const { vehicleId } = req.body;
      await services.fleetService.assignVehicleToDriver(
        fleetOwnerId,
        req.params.driverId,
        vehicleId
      );
      res.json({ success: true, message: "Vehicle assigned" });
    })
  );

  router.delete(
    "/fleet/drivers/:driverId",
    asyncHandler(async (req: Request, res: Response) => {
      const fleetOwnerId = (req as any).driver.id;
      await services.fleetService.removeDriverFromFleet(
        fleetOwnerId,
        req.params.driverId
      );
      res.json({ success: true, message: "Driver removed from fleet" });
    })
  );

  router.get(
    "/fleet/earnings",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const { startDate, endDate } = req.query;
      const earnings = await services.fleetService.getFleetEarnings(
        driverId,
        new Date(startDate as string),
        new Date(endDate as string)
      );
      res.json({ success: true, data: earnings });
    })
  );

  router.post(
    "/fleet/payout",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const { amount } = req.body;
      await services.fleetService.requestPayout(driverId, amount);
      res.json({ success: true, message: "Payout processed" });
    })
  );

  router.post(
    "/fleet/vehicles/:vehicleId/maintenance",
    validateBody(MaintenanceSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const maintenance = await services.fleetService.scheduleMaintenance(
        driverId,
        req.params.vehicleId,
        {
          ...req.body,
          scheduledDate: new Date(req.body.scheduledDate),
        }
      );
      res.status(201).json({ success: true, data: maintenance });
    })
  );

  router.get(
    "/fleet/maintenance",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const { vehicleId } = req.query;
      const history = await services.fleetService.getMaintenanceHistory(
        driverId,
        vehicleId as string
      );
      res.json({ success: true, data: history });
    })
  );

  // -----------------------------------------
  // DEMAND / GUIDANCE ROUTES
  // -----------------------------------------

  router.get(
    "/demand/heatmap",
    asyncHandler(async (req: Request, res: Response) => {
      const { city, latitude, longitude } = req.query;
      const heatmap = await services.demandService?.getDemandHeatmap(
        city as string,
        latitude ? parseFloat(latitude as string) : undefined,
        longitude ? parseFloat(longitude as string) : undefined
      );
      res.json({ success: true, data: heatmap });
    })
  );

  router.get(
    "/guidance",
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = (req as any).driver.id;
      const { latitude, longitude } = req.query;
      const guidance = await services.demandService?.getDriverGuidance(
        driverId,
        parseFloat(latitude as string),
        parseFloat(longitude as string)
      );
      res.json({ success: true, data: guidance });
    })
  );

  return router;
}

export { createDriverExperienceRoutes };
