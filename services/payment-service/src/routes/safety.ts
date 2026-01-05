/**
 * UBI Safety & Trust Platform Routes
 *
 * Comprehensive API endpoints for:
 * - Identity Verification (KYC/KYD)
 * - Trip Safety Monitoring
 * - SOS Emergency Response
 * - Women Safety Features
 * - Fraud Detection & Prevention
 * - Driver Safety Management
 * - Background Checks
 */

import { Hono } from "hono";
import { backgroundCheckService } from "../services/background-check.service";
import { driverSafetyService } from "../services/driver-safety.service";
import { safetyFraudService } from "../services/safety-fraud.service";
import { sosEmergencyService } from "../services/sos.service";
import { tripMonitorService } from "../services/trip-monitor.service";
import { verificationService } from "../services/verification.service";
import { womenSafetyService } from "../services/women-safety.service";
import { DocumentType, SOSTrigger } from "../types/safety.types";

export const safetyRoutes = new Hono();

// =============================================================================
// IDENTITY VERIFICATION ROUTES
// =============================================================================

/**
 * Submit document for verification
 * POST /verification/document
 */
safetyRoutes.post("/verification/document", async (c) => {
  try {
    const { userId, documentType, documentNumber, documentImage, country } =
      await c.req.json();

    if (!userId || !documentType || !documentNumber) {
      return c.json(
        {
          success: false,
          error:
            "Missing required fields: userId, documentType, documentNumber",
        },
        400
      );
    }

    const result = await verificationService.submitDocument(
      userId,
      documentType as DocumentType,
      documentNumber,
      documentImage,
      country || "NG"
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Document submission error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to submit document",
      },
      500
    );
  }
});

/**
 * Capture selfie for verification
 * POST /verification/selfie
 */
safetyRoutes.post("/verification/selfie", async (c) => {
  try {
    const { userId, selfieImage, livenessChallenge } = await c.req.json();

    if (!userId || !selfieImage) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, selfieImage",
        },
        400
      );
    }

    const result = await verificationService.captureSelfie(
      userId,
      selfieImage,
      livenessChallenge
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Selfie capture error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to capture selfie",
      },
      500
    );
  }
});

/**
 * Perform liveness check
 * POST /verification/liveness
 */
safetyRoutes.post("/verification/liveness", async (c) => {
  try {
    const { userId, challengeResponse, videoFrames } = await c.req.json();

    if (!userId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: userId",
        },
        400
      );
    }

    const result = await verificationService.performLivenessCheck(
      userId,
      challengeResponse,
      videoFrames
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Liveness check error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to perform liveness check",
      },
      500
    );
  }
});

/**
 * Match face to document
 * POST /verification/face-match
 */
safetyRoutes.post("/verification/face-match", async (c) => {
  try {
    const { userId, selfieImage, documentImage } = await c.req.json();

    if (!userId || !selfieImage || !documentImage) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, selfieImage, documentImage",
        },
        400
      );
    }

    const result = await verificationService.matchFaceToDocument(
      userId,
      selfieImage,
      documentImage
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Face match error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to match face",
      },
      500
    );
  }
});

/**
 * Send phone OTP for verification
 * POST /verification/phone-otp
 */
safetyRoutes.post("/verification/phone-otp", async (c) => {
  try {
    const { userId, phoneNumber } = await c.req.json();

    if (!userId || !phoneNumber) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, phoneNumber",
        },
        400
      );
    }

    const result = await verificationService.sendPhoneOTP(userId, phoneNumber);

    return c.json({
      success: true,
      data: { sent: result },
    });
  } catch (error: any) {
    console.error("[Safety Routes] Phone OTP error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to send OTP",
      },
      500
    );
  }
});

/**
 * Send email OTP for verification
 * POST /verification/email-otp
 */
safetyRoutes.post("/verification/email-otp", async (c) => {
  try {
    const { userId, email } = await c.req.json();

    if (!userId || !email) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, email",
        },
        400
      );
    }

    const result = await verificationService.sendEmailOTP(userId, email);

    return c.json({
      success: true,
      data: { sent: result },
    });
  } catch (error: any) {
    console.error("[Safety Routes] Email OTP error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to send email OTP",
      },
      500
    );
  }
});

/**
 * Verify OTP
 * POST /verification/verify-otp
 */
safetyRoutes.post("/verification/verify-otp", async (c) => {
  try {
    const { userId, otp, type } = await c.req.json();

    if (!userId || !otp || !type) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, otp, type",
        },
        400
      );
    }

    const result = await verificationService.verifyOTP(userId, otp, type);

    return c.json({
      success: true,
      data: { verified: result },
    });
  } catch (error: any) {
    console.error("[Safety Routes] OTP verification error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to verify OTP",
      },
      500
    );
  }
});

/**
 * Get user verification status
 * GET /verification/status/:userId
 */
safetyRoutes.get("/verification/status/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    const level = await verificationService.getUserVerificationLevel(userId);
    const verifications =
      await verificationService.getUserVerifications(userId);

    return c.json({
      success: true,
      data: {
        level,
        verifications,
      },
    });
  } catch (error: any) {
    console.error("[Safety Routes] Verification status error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get verification status",
      },
      500
    );
  }
});

// =============================================================================
// TRIP SAFETY MONITORING ROUTES
// =============================================================================

/**
 * Start trip monitoring
 * POST /trip/monitor/start
 */
safetyRoutes.post("/trip/monitor/start", async (c) => {
  try {
    const { tripId, riderId, driverId, plannedRoute, estimatedDuration } =
      await c.req.json();

    if (!tripId || !riderId || !driverId) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: tripId, riderId, driverId",
        },
        400
      );
    }

    const session = await tripMonitorService.startMonitoring(
      tripId,
      riderId,
      driverId,
      plannedRoute,
      estimatedDuration
    );

    return c.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Trip monitor start error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to start monitoring",
      },
      500
    );
  }
});

/**
 * Process location update
 * POST /trip/location
 */
safetyRoutes.post("/trip/location", async (c) => {
  try {
    const { tripId, latitude, longitude, speed, heading, accuracy, timestamp } =
      await c.req.json();

    if (!tripId || latitude === undefined || longitude === undefined) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: tripId, latitude, longitude",
        },
        400
      );
    }

    await tripMonitorService.processLocationUpdate(tripId, {
      latitude,
      longitude,
      speed,
      heading,
      accuracy,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Location update error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to process location",
      },
      500
    );
  }
});

/**
 * Process accelerometer data (crash detection)
 * POST /trip/accelerometer
 */
safetyRoutes.post("/trip/accelerometer", async (c) => {
  try {
    const { tripId, data } = await c.req.json();

    if (!tripId || !data) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: tripId, data",
        },
        400
      );
    }

    await tripMonitorService.processAccelerometerData(tripId, data);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Accelerometer data error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to process accelerometer data",
      },
      500
    );
  }
});

/**
 * Trigger safety check-in
 * POST /trip/checkin/trigger
 */
safetyRoutes.post("/trip/checkin/trigger", async (c) => {
  try {
    const { tripId, reason } = await c.req.json();

    if (!tripId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: tripId",
        },
        400
      );
    }

    const checkIn = await tripMonitorService.triggerSafetyCheck(tripId, reason);

    return c.json({
      success: true,
      data: checkIn,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Safety check trigger error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to trigger safety check",
      },
      500
    );
  }
});

/**
 * Respond to safety check-in
 * POST /trip/checkin/respond
 */
safetyRoutes.post("/trip/checkin/respond", async (c) => {
  try {
    const { checkInId, isOkay, message } = await c.req.json();

    if (!checkInId || isOkay === undefined) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: checkInId, isOkay",
        },
        400
      );
    }

    await tripMonitorService.respondToSafetyCheck(checkInId, isOkay, message);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Safety check response error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to respond to safety check",
      },
      500
    );
  }
});

/**
 * Create trip share link
 * POST /trip/share
 */
safetyRoutes.post("/trip/share", async (c) => {
  try {
    const { tripId, shareWithContacts, expiresAt } = await c.req.json();

    if (!tripId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: tripId",
        },
        400
      );
    }

    const share = await tripMonitorService.createTripShare(
      tripId,
      shareWithContacts,
      expiresAt ? new Date(expiresAt) : undefined
    );

    return c.json({
      success: true,
      data: share,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Trip share error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to create trip share",
      },
      500
    );
  }
});

/**
 * Stop trip monitoring
 * POST /trip/monitor/stop
 */
safetyRoutes.post("/trip/monitor/stop", async (c) => {
  try {
    const { tripId } = await c.req.json();

    if (!tripId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: tripId",
        },
        400
      );
    }

    await tripMonitorService.stopMonitoring(tripId);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Trip monitor stop error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to stop monitoring",
      },
      500
    );
  }
});

/**
 * Get trip safety status
 * GET /trip/:tripId/status
 */
safetyRoutes.get("/trip/:tripId/status", async (c) => {
  try {
    const tripId = c.req.param("tripId");

    const session = await tripMonitorService.getMonitoringSession(tripId);

    if (!session) {
      return c.json(
        {
          success: false,
          error: "Trip not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Trip status error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get trip status",
      },
      500
    );
  }
});

// =============================================================================
// SOS EMERGENCY ROUTES
// =============================================================================

/**
 * Trigger SOS emergency
 * POST /sos/trigger
 */
safetyRoutes.post("/sos/trigger", async (c) => {
  try {
    const { userId, tripId, trigger, location, audioData } = await c.req.json();

    if (!userId || !trigger) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, trigger",
        },
        400
      );
    }

    const sos = await sosEmergencyService.triggerSOS(
      userId,
      tripId,
      trigger as SOSTrigger,
      location,
      audioData
    );

    return c.json({
      success: true,
      data: sos,
    });
  } catch (error: any) {
    console.error("[Safety Routes] SOS trigger error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to trigger SOS",
      },
      500
    );
  }
});

/**
 * Cancel SOS (requires PIN)
 * POST /sos/cancel
 */
safetyRoutes.post("/sos/cancel", async (c) => {
  try {
    const { sosId, pin, reason } = await c.req.json();

    if (!sosId || !pin) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: sosId, pin",
        },
        400
      );
    }

    const result = await sosEmergencyService.cancelSOS(sosId, pin, reason);

    return c.json({
      success: true,
      data: { cancelled: result },
    });
  } catch (error: any) {
    console.error("[Safety Routes] SOS cancel error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to cancel SOS",
      },
      500
    );
  }
});

/**
 * Respond to SOS (for agents)
 * POST /sos/respond
 */
safetyRoutes.post("/sos/respond", async (c) => {
  try {
    const { sosId, agentId, response, notes } = await c.req.json();

    if (!sosId || !agentId || !response) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: sosId, agentId, response",
        },
        400
      );
    }

    await sosEmergencyService.respondToSOS(sosId, agentId, response, notes);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] SOS respond error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to respond to SOS",
      },
      500
    );
  }
});

/**
 * Mark SOS as false alarm
 * POST /sos/false-alarm
 */
safetyRoutes.post("/sos/false-alarm", async (c) => {
  try {
    const { sosId, agentId, reason } = await c.req.json();

    if (!sosId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: sosId",
        },
        400
      );
    }

    await sosEmergencyService.markAsFalseAlarm(sosId, agentId, reason);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] SOS false alarm error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to mark as false alarm",
      },
      500
    );
  }
});

/**
 * Get SOS status
 * GET /sos/:sosId
 */
safetyRoutes.get("/sos/:sosId", async (c) => {
  try {
    const sosId = c.req.param("sosId");

    const sos = await sosEmergencyService.getSOSIncident(sosId);

    if (!sos) {
      return c.json(
        {
          success: false,
          error: "SOS not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: sos,
    });
  } catch (error: any) {
    console.error("[Safety Routes] SOS get error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get SOS",
      },
      500
    );
  }
});

/**
 * Add emergency contact
 * POST /emergency-contacts
 */
safetyRoutes.post("/emergency-contacts", async (c) => {
  try {
    const { userId, name, phone, relationship } = await c.req.json();

    if (!userId || !name || !phone) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, name, phone",
        },
        400
      );
    }

    const contact = await sosEmergencyService.addEmergencyContact(userId, {
      name,
      phone,
      relationship,
    });

    return c.json({
      success: true,
      data: contact,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Add contact error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to add contact",
      },
      500
    );
  }
});

/**
 * Get emergency contacts
 * GET /emergency-contacts/:userId
 */
safetyRoutes.get("/emergency-contacts/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    const contacts = await sosEmergencyService.getEmergencyContacts(userId);

    return c.json({
      success: true,
      data: contacts,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Get contacts error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get contacts",
      },
      500
    );
  }
});

// =============================================================================
// WOMEN SAFETY ROUTES
// =============================================================================

/**
 * Find female drivers
 * POST /women/find-drivers
 */
safetyRoutes.post("/women/find-drivers", async (c) => {
  try {
    const { riderId, pickupLocation, radius } = await c.req.json();

    if (!riderId || !pickupLocation) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: riderId, pickupLocation",
        },
        400
      );
    }

    const drivers = await womenSafetyService.findFemaleDrivers(
      riderId,
      pickupLocation,
      radius
    );

    return c.json({
      success: true,
      data: drivers,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Find female drivers error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to find drivers",
      },
      500
    );
  }
});

/**
 * Register as female driver
 * POST /women/register-driver
 */
safetyRoutes.post("/women/register-driver", async (c) => {
  try {
    const { driverId, preferFemaleRiders, verificationDocument } =
      await c.req.json();

    if (!driverId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: driverId",
        },
        400
      );
    }

    await womenSafetyService.registerFemaleDriver(
      driverId,
      preferFemaleRiders,
      verificationDocument
    );

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Register female driver error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to register driver",
      },
      500
    );
  }
});

/**
 * Generate trip PIN
 * POST /women/trip-pin
 */
safetyRoutes.post("/women/trip-pin", async (c) => {
  try {
    const { tripId, riderId } = await c.req.json();

    if (!tripId || !riderId) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: tripId, riderId",
        },
        400
      );
    }

    const pin = await womenSafetyService.generateTripPin(tripId, riderId);

    return c.json({
      success: true,
      data: { pin },
    });
  } catch (error: any) {
    console.error("[Safety Routes] Generate PIN error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to generate PIN",
      },
      500
    );
  }
});

/**
 * Verify trip PIN
 * POST /women/verify-pin
 */
safetyRoutes.post("/women/verify-pin", async (c) => {
  try {
    const { tripId, pin } = await c.req.json();

    if (!tripId || !pin) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: tripId, pin",
        },
        400
      );
    }

    const verified = await womenSafetyService.verifyTripPin(tripId, pin);

    return c.json({
      success: true,
      data: { verified },
    });
  } catch (error: any) {
    console.error("[Safety Routes] Verify PIN error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to verify PIN",
      },
      500
    );
  }
});

/**
 * Set safe words
 * POST /women/safe-words
 */
safetyRoutes.post("/women/safe-words", async (c) => {
  try {
    const { userId, safeWords } = await c.req.json();

    if (!userId || !safeWords || !Array.isArray(safeWords)) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, safeWords (array)",
        },
        400
      );
    }

    await womenSafetyService.setSafeWords(userId, safeWords);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Set safe words error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to set safe words",
      },
      500
    );
  }
});

/**
 * Update women safety preferences
 * PUT /women/preferences/:userId
 */
safetyRoutes.put("/women/preferences/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const preferences = await c.req.json();

    await womenSafetyService.updatePreferences(userId, preferences);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Update preferences error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to update preferences",
      },
      500
    );
  }
});

/**
 * Get women safety preferences
 * GET /women/preferences/:userId
 */
safetyRoutes.get("/women/preferences/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    const preferences = await womenSafetyService.getPreferences(userId);

    return c.json({
      success: true,
      data: preferences,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Get preferences error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get preferences",
      },
      500
    );
  }
});

// =============================================================================
// FRAUD DETECTION ROUTES
// =============================================================================

/**
 * Assess risk for user/action
 * POST /fraud/assess
 */
safetyRoutes.post("/fraud/assess", async (c) => {
  try {
    const { userId, actionType, metadata, deviceInfo } = await c.req.json();

    if (!userId || !actionType) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, actionType",
        },
        400
      );
    }

    const assessment = await safetyFraudService.assessRisk(
      userId,
      actionType,
      metadata,
      deviceInfo
    );

    return c.json({
      success: true,
      data: assessment,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Risk assessment error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to assess risk",
      },
      500
    );
  }
});

/**
 * Register device
 * POST /fraud/device/register
 */
safetyRoutes.post("/fraud/device/register", async (c) => {
  try {
    const { userId, deviceInfo } = await c.req.json();

    if (!userId || !deviceInfo) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, deviceInfo",
        },
        400
      );
    }

    const result = await safetyFraudService.registerDevice(userId, deviceInfo);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Device registration error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to register device",
      },
      500
    );
  }
});

/**
 * Report fraud
 * POST /fraud/report
 */
safetyRoutes.post("/fraud/report", async (c) => {
  try {
    const { reporterId, reportedUserId, fraudType, description, evidence } =
      await c.req.json();

    if (!reporterId || !reportedUserId || !fraudType) {
      return c.json(
        {
          success: false,
          error:
            "Missing required fields: reporterId, reportedUserId, fraudType",
        },
        400
      );
    }

    const report = await safetyFraudService.reportFraud(
      reporterId,
      reportedUserId,
      fraudType,
      description,
      evidence
    );

    return c.json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Fraud report error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to report fraud",
      },
      500
    );
  }
});

/**
 * Get user risk profile
 * GET /fraud/risk/:userId
 */
safetyRoutes.get("/fraud/risk/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    const profile = await safetyFraudService.getUserRiskProfile(userId);

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Get risk profile error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get risk profile",
      },
      500
    );
  }
});

/**
 * Check promo abuse
 * POST /fraud/promo-check
 */
safetyRoutes.post("/fraud/promo-check", async (c) => {
  try {
    const { userId, promoCode, deviceInfo, referrerId } = await c.req.json();

    if (!userId || !promoCode) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: userId, promoCode",
        },
        400
      );
    }

    const result = await safetyFraudService.detectPromoAbuse(
      userId,
      promoCode,
      deviceInfo,
      referrerId
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Promo check error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to check promo",
      },
      500
    );
  }
});

// =============================================================================
// DRIVER SAFETY ROUTES
// =============================================================================

/**
 * Get driver safety profile
 * GET /driver/:driverId/profile
 */
safetyRoutes.get("/driver/:driverId/profile", async (c) => {
  try {
    const driverId = c.req.param("driverId");

    const profile = await driverSafetyService.getDriverSafetyProfile(driverId);

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Get driver profile error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get driver profile",
      },
      500
    );
  }
});

/**
 * Report driver incident
 * POST /driver/incident
 */
safetyRoutes.post("/driver/incident", async (c) => {
  try {
    const {
      driverId,
      incidentType,
      description,
      reporterId,
      tripId,
      evidence,
    } = await c.req.json();

    if (!driverId || !incidentType) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: driverId, incidentType",
        },
        400
      );
    }

    const incident = await driverSafetyService.reportIncident(
      driverId,
      incidentType,
      description,
      reporterId,
      tripId,
      evidence
    );

    return c.json({
      success: true,
      data: incident,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Report incident error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to report incident",
      },
      500
    );
  }
});

/**
 * Check risk zone
 * POST /driver/risk-zone
 */
safetyRoutes.post("/driver/risk-zone", async (c) => {
  try {
    const { latitude, longitude } = await c.req.json();

    if (latitude === undefined || longitude === undefined) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: latitude, longitude",
        },
        400
      );
    }

    const zone = await driverSafetyService.getRiskZone(latitude, longitude);

    return c.json({
      success: true,
      data: zone,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Risk zone error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to check risk zone",
      },
      500
    );
  }
});

/**
 * Assess cash trip risk
 * POST /driver/cash-risk
 */
safetyRoutes.post("/driver/cash-risk", async (c) => {
  try {
    const { driverId, riderId, tripDetails } = await c.req.json();

    if (!driverId || !riderId || !tripDetails) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: driverId, riderId, tripDetails",
        },
        400
      );
    }

    const assessment = await driverSafetyService.assessCashTripRisk(
      driverId,
      riderId,
      tripDetails
    );

    return c.json({
      success: true,
      data: assessment,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Cash risk assessment error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to assess cash risk",
      },
      500
    );
  }
});

/**
 * Check driver fatigue
 * POST /driver/fatigue-check
 */
safetyRoutes.post("/driver/fatigue-check", async (c) => {
  try {
    const { driverId } = await c.req.json();

    if (!driverId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: driverId",
        },
        400
      );
    }

    const status = await driverSafetyService.checkFatigue(driverId);

    return c.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Fatigue check error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to check fatigue",
      },
      500
    );
  }
});

/**
 * Get driver safety recommendations
 * GET /driver/:driverId/recommendations
 */
safetyRoutes.get("/driver/:driverId/recommendations", async (c) => {
  try {
    const driverId = c.req.param("driverId");

    const recommendations =
      await driverSafetyService.getDriverSafetyRecommendations(driverId);

    return c.json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Get recommendations error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get recommendations",
      },
      500
    );
  }
});

// =============================================================================
// BACKGROUND CHECK ROUTES
// =============================================================================

/**
 * Initiate background check
 * POST /background/initiate
 */
safetyRoutes.post("/background/initiate", async (c) => {
  try {
    const {
      userId,
      checkTypes,
      country,
      idNumber,
      idType,
      firstName,
      lastName,
      dateOfBirth,
      consentGiven,
    } = await c.req.json();

    if (!userId || !checkTypes || !country || !consentGiven) {
      return c.json(
        {
          success: false,
          error:
            "Missing required fields: userId, checkTypes, country, consentGiven",
        },
        400
      );
    }

    const results = await backgroundCheckService.initiateBackgroundCheck({
      userId,
      checkTypes,
      country,
      idNumber,
      idType,
      firstName,
      lastName,
      dateOfBirth,
      consentGiven,
    });

    return c.json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Background check initiate error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to initiate background check",
      },
      500
    );
  }
});

/**
 * Check background check status
 * GET /background/:userId/:checkType
 */
safetyRoutes.get("/background/:userId/:checkType", async (c) => {
  try {
    const userId = c.req.param("userId");
    const checkType = c.req.param("checkType");

    const check = await backgroundCheckService.checkStatus(
      userId,
      checkType as any
    );

    if (!check) {
      return c.json(
        {
          success: false,
          error: "Background check not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: check,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Background check status error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get background check status",
      },
      500
    );
  }
});

/**
 * Get all background checks for user
 * GET /background/user/:userId
 */
safetyRoutes.get("/background/user/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    const checks = await backgroundCheckService.getUserBackgroundChecks(userId);

    return c.json({
      success: true,
      data: checks,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Get background checks error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get background checks",
      },
      500
    );
  }
});

/**
 * Get background check summary
 * GET /background/user/:userId/summary
 */
safetyRoutes.get("/background/user/:userId/summary", async (c) => {
  try {
    const userId = c.req.param("userId");

    const summary =
      await backgroundCheckService.getBackgroundCheckSummary(userId);

    return c.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Background summary error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get background summary",
      },
      500
    );
  }
});

/**
 * Check if driver is cleared
 * GET /background/driver/:driverId/cleared
 */
safetyRoutes.get("/background/driver/:driverId/cleared", async (c) => {
  try {
    const driverId = c.req.param("driverId");

    const result = await backgroundCheckService.isDriverClear(driverId);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Driver clearance check error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to check driver clearance",
      },
      500
    );
  }
});

/**
 * Enable continuous monitoring
 * POST /background/monitoring/enable
 */
safetyRoutes.post("/background/monitoring/enable", async (c) => {
  try {
    const { userId } = await c.req.json();

    if (!userId) {
      return c.json(
        {
          success: false,
          error: "Missing required field: userId",
        },
        400
      );
    }

    await backgroundCheckService.enableContinuousMonitoring(userId);

    return c.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Enable monitoring error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to enable monitoring",
      },
      500
    );
  }
});

/**
 * Get monitoring alerts
 * GET /background/monitoring/:userId/alerts
 */
safetyRoutes.get("/background/monitoring/:userId/alerts", async (c) => {
  try {
    const userId = c.req.param("userId");

    const alerts = await backgroundCheckService.getMonitoringAlerts(userId);

    return c.json({
      success: true,
      data: alerts,
    });
  } catch (error: any) {
    console.error("[Safety Routes] Get alerts error:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to get alerts",
      },
      500
    );
  }
});
