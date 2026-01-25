/**
 * UBI SOS Emergency Service
 *
 * Comprehensive emergency response system:
 * - Multi-trigger SOS (button, voice, shake, auto-detect)
 * - Multi-level escalation (4 levels)
 * - Audio/video recording during emergency
 * - Emergency contact notification
 * - Law enforcement integration
 * - Safety team dashboard integration
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { sosLogger } from "../lib/logger";
import {
  COUNTRY_CONFIGS,
  EmergencyContact,
  EmergencyNotification,
  Location,
  SafetyAgent,
  SOSEscalationLevel,
  SOSIncident,
  SOSResponse,
  UserSafetyContext,
} from "../types/safety.types";

// =============================================================================
// SOS EMERGENCY SERVICE
// =============================================================================

export class SOSEmergencyService extends EventEmitter {
  private activeIncidents: Map<string, SOSIncident> = new Map();
  private incidentTimelines: Map<string, SOSTimelineEntry[]> = new Map();
  private safetyAgents: Map<string, SafetyAgent> = new Map();
  private agentAssignments: Map<string, string> = new Map(); // incidentId -> agentId
  private audioRecordings: Map<string, AudioRecordingSession> = new Map();

  // Escalation timing (seconds)
  private readonly LEVEL_1_TIMEOUT = 60; // 1 minute
  private readonly LEVEL_2_TIMEOUT = 120; // 2 minutes
  private readonly LEVEL_3_TIMEOUT = 180; // 3 minutes

  constructor() {
    super();
    this.initializeMockAgents();
  }

  // ---------------------------------------------------------------------------
  // SOS TRIGGERING
  // ---------------------------------------------------------------------------

  async triggerSOS(params: TriggerSOSParams): Promise<SOSIncident> {
    const {
      userId,
      tripId,
      driverId,
      triggerMethod,
      location,
      batteryLevel,
      networkType,
    } = params;

    // Check for duplicate active SOS
    const existing = await this.getActiveSOSForUser(userId);
    if (existing) {
      // Update location and return existing
      existing.currentLocation = location;
      return existing;
    }

    const incident: SOSIncident = {
      id: this.generateId(),
      userId,
      tripId,
      driverId,
      status: "ACTIVE",
      escalationLevel: "LEVEL_1",
      triggerMethod,
      triggerLocation: location,
      currentLocation: location,
      batteryLevel,
      networkType,
      triggeredAt: new Date(),
    };

    this.activeIncidents.set(incident.id, incident);
    this.incidentTimelines.set(incident.id, []);

    // Add timeline entry
    this.addTimelineEntry(incident.id, "sos_triggered", {
      method: triggerMethod,
      location,
      userId,
    });

    // Start audio recording
    const recording = await this.startAudioRecording(incident.id, userId);
    if (recording) {
      incident.audioRecordingUrl = recording.url;
    }

    // Assign to safety agent
    const agent = await this.assignToAgent(incident);
    if (agent) {
      incident.assignedAgentId = agent.id;
      this.addTimelineEntry(incident.id, "agent_assigned", {
        agentId: agent.id,
        agentName: agent.name,
      });
    }

    // Notify emergency contacts
    await this.notifyEmergencyContacts(incident);

    // Start escalation timer
    this.startEscalationTimer(incident);

    // Emit event
    this.emit("sos_triggered", incident);

    sosLogger.info(
      { incidentId: incident.id, triggerMethod, userId },
      "[SOSService] SOS triggered",
    );

    return incident;
  }

  async cancelSOS(
    incidentId: string,
    userId: string,
    reason?: string,
  ): Promise<{ success: boolean; verificationRequired?: boolean }> {
    const incident = this.activeIncidents.get(incidentId);

    if (!incident) {
      return { success: false };
    }

    // Only the user who triggered can cancel
    if (incident.userId !== userId) {
      return { success: false };
    }

    // If escalated beyond LEVEL_1, require verification
    if (incident.escalationLevel !== "LEVEL_1") {
      // In production, this would require PIN or callback verification
      return { success: false, verificationRequired: true };
    }

    incident.status = "CANCELLED";
    incident.resolvedAt = new Date();
    incident.resolutionType = "user_cancelled";

    this.addTimelineEntry(incidentId, "sos_cancelled", {
      reason,
      cancelledBy: userId,
    });

    // Stop audio recording
    await this.stopAudioRecording(incidentId);

    // Notify assigned agent
    if (incident.assignedAgentId) {
      this.notifyAgent(incident.assignedAgentId, "sos_cancelled", incident);
    }

    // Archive incident
    this.activeIncidents.delete(incidentId);

    this.emit("sos_cancelled", incident);

    sosLogger.info({ incidentId }, "[SOSService] SOS cancelled");

    return { success: true };
  }

  async verifyCancellation(incidentId: string, pin: string): Promise<boolean> {
    const incident = this.activeIncidents.get(incidentId);
    if (!incident) return false;

    // In production, verify PIN against user's safety PIN
    const isValid = await this.verifyUserPin(incident.userId, pin);

    if (isValid) {
      incident.status = "CANCELLED";
      incident.resolvedAt = new Date();
      incident.resolutionType = "user_verified_cancel";

      this.addTimelineEntry(incidentId, "sos_cancelled", {
        method: "pin_verified",
      });
      await this.stopAudioRecording(incidentId);

      this.activeIncidents.delete(incidentId);
      this.emit("sos_cancelled", incident);
    }

    return isValid;
  }

  // ---------------------------------------------------------------------------
  // AGENT RESPONSE
  // ---------------------------------------------------------------------------

  async respondToSOS(
    response: SOSResponse,
  ): Promise<{ success: boolean; incident?: SOSIncident }> {
    const { incidentId, agentId, action, notes, escalationReason } = response;

    const incident = this.activeIncidents.get(incidentId);
    if (!incident) {
      return { success: false };
    }

    // Record first response time
    if (!incident.firstResponseAt) {
      incident.firstResponseAt = new Date();
      incident.responseTimeSeconds = Math.floor(
        (incident.firstResponseAt.getTime() - incident.triggeredAt.getTime()) /
          1000,
      );
    }

    this.addTimelineEntry(incidentId, `agent_${action}`, {
      agentId,
      notes,
      escalationReason,
    });

    switch (action) {
      case "acknowledge":
        incident.status = "RESPONDED";
        break;

      case "contact_user":
        await this.initiateAgentCallback(incident, agentId);
        break;

      case "escalate":
        await this.escalateIncident(
          incident,
          escalationReason || "Agent escalation",
        );
        break;

      case "dispatch":
        await this.dispatchEmergencyServices(incident);
        break;

      case "resolve":
        incident.status = "RESOLVED";
        incident.resolvedAt = new Date();
        incident.resolutionType = "agent_resolved";
        await this.stopAudioRecording(incidentId);
        this.activeIncidents.delete(incidentId);
        break;
    }

    this.emit("sos_response", { incident, response });

    return { success: true, incident };
  }

  async markAsFalseAlarm(
    incidentId: string,
    agentId: string,
    reason: string,
  ): Promise<boolean> {
    const incident = this.activeIncidents.get(incidentId);
    if (!incident) return false;

    incident.status = "FALSE_ALARM";
    incident.resolvedAt = new Date();
    incident.resolutionType = "false_alarm";

    this.addTimelineEntry(incidentId, "marked_false_alarm", {
      agentId,
      reason,
    });

    await this.stopAudioRecording(incidentId);

    // Update user stats (too many false alarms may require review)
    await this.recordFalseAlarm(incident.userId);

    this.activeIncidents.delete(incidentId);

    this.emit("sos_false_alarm", incident);

    return true;
  }

  // ---------------------------------------------------------------------------
  // ESCALATION
  // ---------------------------------------------------------------------------

  private startEscalationTimer(incident: SOSIncident): void {
    // Level 1 -> Level 2
    setTimeout(
      () => this.checkAndEscalate(incident.id, "LEVEL_2"),
      this.LEVEL_1_TIMEOUT * 1000,
    );

    // Level 2 -> Level 3
    setTimeout(
      () => this.checkAndEscalate(incident.id, "LEVEL_3"),
      this.LEVEL_2_TIMEOUT * 1000,
    );

    // Level 3 -> Level 4
    setTimeout(
      () => this.checkAndEscalate(incident.id, "LEVEL_4"),
      this.LEVEL_3_TIMEOUT * 1000,
    );
  }

  private async checkAndEscalate(
    incidentId: string,
    targetLevel: SOSEscalationLevel,
  ): Promise<void> {
    const incident = this.activeIncidents.get(incidentId);

    if (!incident || incident.status !== "ACTIVE") {
      return;
    }

    // Check if already at or beyond target level
    const levels: SOSEscalationLevel[] = [
      "LEVEL_1",
      "LEVEL_2",
      "LEVEL_3",
      "LEVEL_4",
    ];
    const currentIndex = levels.indexOf(incident.escalationLevel);
    const targetIndex = levels.indexOf(targetLevel);

    if (currentIndex >= targetIndex) {
      return;
    }

    await this.escalateIncident(
      incident,
      `Auto-escalation: No resolution after ${this.getEscalationTime(targetLevel)}s`,
    );
  }

  private async escalateIncident(
    incident: SOSIncident,
    reason: string,
  ): Promise<void> {
    const levels: SOSEscalationLevel[] = [
      "LEVEL_1",
      "LEVEL_2",
      "LEVEL_3",
      "LEVEL_4",
    ];
    const currentIndex = levels.indexOf(incident.escalationLevel);

    if (currentIndex >= levels.length - 1) {
      // Already at max level
      return;
    }

    const newLevel = levels[currentIndex + 1];
    if (newLevel) {
      incident.escalationLevel = newLevel;
      incident.status = "ESCALATED";
    } else {
      return;
    }

    this.addTimelineEntry(incident.id, "escalated", {
      from: levels[currentIndex],
      to: newLevel,
      reason,
    });

    sosLogger.info(
      { incidentId: incident.id, newLevel },
      "[SOSService] Escalated incident",
    );

    // Level-specific actions
    switch (newLevel) {
      case "LEVEL_2":
        // Alert senior safety agents
        await this.alertSeniorAgents(incident);
        // Consider contacting law enforcement
        break;

      case "LEVEL_3":
        // Contact law enforcement
        await this.contactLawEnforcement(incident);
        // Alert safety team managers
        await this.alertManagers(incident);
        break;

      case "LEVEL_4":
        // All hands on deck
        await this.triggerAllHandsAlert(incident);
        // Ensure emergency services dispatched
        await this.ensureEmergencyDispatch(incident);
        break;
    }

    this.emit("sos_escalated", { incident, newLevel, reason });
  }

  private getEscalationTime(level: SOSEscalationLevel): number {
    switch (level) {
      case "LEVEL_2":
        return this.LEVEL_1_TIMEOUT;
      case "LEVEL_3":
        return this.LEVEL_2_TIMEOUT;
      case "LEVEL_4":
        return this.LEVEL_3_TIMEOUT;
      default:
        return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // EMERGENCY CONTACTS
  // ---------------------------------------------------------------------------

  async notifyEmergencyContacts(
    incident: SOSIncident,
  ): Promise<EmergencyNotification[]> {
    const contacts = await this.getUserEmergencyContacts(incident.userId);
    const notifications: EmergencyNotification[] = [];

    const locationLink = await this.generateLiveLocationLink(incident.id);

    for (const contact of contacts) {
      // Primary contact gets all channels
      const channels: ("sms" | "whatsapp" | "call")[] = [];

      channels.push("sms");

      if (contact.whatsappEnabled) {
        channels.push("whatsapp");
      }

      if (contact.isPrimary) {
        channels.push("call");
      }

      for (const channel of channels) {
        const notification = await this.sendEmergencyNotification(
          contact,
          incident,
          channel,
          locationLink,
        );
        notifications.push(notification);
      }
    }

    this.addTimelineEntry(incident.id, "contacts_notified", {
      contactCount: contacts.length,
      notifications: notifications.length,
    });

    return notifications;
  }

  private async sendEmergencyNotification(
    contact: EmergencyContact,
    incident: SOSIncident,
    channel: "sms" | "whatsapp" | "call" | "email" | "push",
    locationLink: string,
  ): Promise<EmergencyNotification> {
    const notification: EmergencyNotification = {
      contactId: contact.id,
      channel,
      status: "sent",
      locationLink,
      sentAt: new Date(),
    };

    // In production, use actual notification services
    switch (channel) {
      case "sms":
        await this.sendEmergencySMS(
          contact.phoneNumber,
          incident,
          locationLink,
        );
        break;
      case "whatsapp":
        await this.sendEmergencyWhatsApp(
          contact.phoneNumber,
          incident,
          locationLink,
        );
        break;
      case "call":
        await this.initiateEmergencyCall(contact.phoneNumber, incident);
        break;
    }

    sosLogger.info(
      { channel, contactName: contact.name },
      "[SOSService] Emergency notification sent",
    );

    return notification;
  }

  private async sendEmergencySMS(
    phone: string,
    _incident: SOSIncident,
    locationLink: string,
  ): Promise<void> {
    const message =
      `🚨 EMERGENCY: Your contact has triggered an SOS alert on UBI. ` +
      `Track their location: ${locationLink}. ` +
      `If you cannot reach them, call emergency services.`;

    // In production, use SMS provider
    sosLogger.info(
      { phoneLast4: phone.slice(-4), messagePreview: message.substring(0, 50) },
      "[SOSService] Sending SMS",
    );
  }

  private async sendEmergencyWhatsApp(
    phone: string,
    _incident: SOSIncident,
    _locationLink: string,
  ): Promise<void> {
    // In production, use WhatsApp Business API
    sosLogger.info(
      { phoneLast4: phone.slice(-4) },
      "[SOSService] WhatsApp sent",
    );
  }

  private async initiateEmergencyCall(
    phone: string,
    _incident: SOSIncident,
  ): Promise<void> {
    // In production, use voice API (Twilio, Africa's Talking)
    sosLogger.info(
      { phoneLast4: phone.slice(-4) },
      "[SOSService] Initiating call",
    );
  }

  // ---------------------------------------------------------------------------
  // LAW ENFORCEMENT
  // ---------------------------------------------------------------------------

  private async contactLawEnforcement(incident: SOSIncident): Promise<void> {
    // Get country config for emergency numbers
    const userCountry = await this.getUserCountry(incident.userId);
    const config = COUNTRY_CONFIGS[userCountry];

    if (!config) {
      sosLogger.info(
        "[SOSService] Unknown country for law enforcement contact",
      );
      return;
    }

    this.addTimelineEntry(incident.id, "law_enforcement_contacted", {
      country: userCountry,
      emergencyNumber: config.emergencyNumber,
    });

    // In production, this would:
    // 1. Integrate with local emergency services API if available
    // 2. Generate a report with all incident details
    // 3. Potentially auto-dial emergency services
    // 4. Send location data to authorities

    sosLogger.info(
      { incidentId: incident.id, emergencyNumber: config.emergencyNumber },
      "[SOSService] Contacting law enforcement",
    );
  }

  private async dispatchEmergencyServices(
    incident: SOSIncident,
  ): Promise<void> {
    this.addTimelineEntry(incident.id, "emergency_services_dispatched", {
      location: incident.currentLocation,
    });

    await this.contactLawEnforcement(incident);

    sosLogger.info(
      { incidentId: incident.id },
      "[SOSService] Emergency services dispatched",
    );
  }

  private async ensureEmergencyDispatch(incident: SOSIncident): Promise<void> {
    // Check if already dispatched
    const timeline = this.incidentTimelines.get(incident.id) || [];
    const dispatched = timeline.some(
      (e) => e.type === "emergency_services_dispatched",
    );

    if (!dispatched) {
      await this.dispatchEmergencyServices(incident);
    }
  }

  // ---------------------------------------------------------------------------
  // AUDIO/VIDEO RECORDING
  // ---------------------------------------------------------------------------

  private async startAudioRecording(
    incidentId: string,
    userId: string,
  ): Promise<AudioRecordingSession | null> {
    const session: AudioRecordingSession = {
      id: this.generateId(),
      incidentId,
      userId,
      url: `https://storage.ubi.app/sos-recordings/${incidentId}`,
      startedAt: new Date(),
      isActive: true,
    };

    this.audioRecordings.set(incidentId, session);

    // In production, this would:
    // 1. Signal the mobile app to start recording
    // 2. Stream audio to secure storage
    // 3. Enable two-way communication with safety team

    sosLogger.info({ incidentId }, "[SOSService] Audio recording started");

    return session;
  }

  private async stopAudioRecording(incidentId: string): Promise<void> {
    const session = this.audioRecordings.get(incidentId);

    if (session) {
      session.isActive = false;
      session.endedAt = new Date();
      this.audioRecordings.delete(incidentId);

      sosLogger.info({ incidentId }, "[SOSService] Audio recording stopped");
    }
  }

  async streamAudioChunk(incidentId: string, chunk: Buffer): Promise<void> {
    const session = this.audioRecordings.get(incidentId);

    if (session && session.isActive) {
      // In production, append to storage
      sosLogger.info(
        { chunkLength: chunk.length },
        "[SOSService] Audio chunk received",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // SAFETY AGENT MANAGEMENT
  // ---------------------------------------------------------------------------

  private async assignToAgent(
    incident: SOSIncident,
  ): Promise<SafetyAgent | null> {
    // Find available agent with lowest active incidents
    let bestAgent: SafetyAgent | null = null;
    let lowestLoad = Infinity;

    for (const agent of this.safetyAgents.values()) {
      if (
        agent.isOnDuty &&
        agent.team === "sos_response" &&
        agent.activeIncidents < agent.maxIncidents &&
        agent.activeIncidents < lowestLoad
      ) {
        bestAgent = agent;
        lowestLoad = agent.activeIncidents;
      }
    }

    if (bestAgent) {
      bestAgent.activeIncidents++;
      this.agentAssignments.set(incident.id, bestAgent.id);

      // Notify agent
      await this.notifyAgent(bestAgent.id, "new_incident", incident);
    }

    return bestAgent;
  }

  private async notifyAgent(
    agentId: string,
    type: string,
    _incident: SOSIncident,
  ): Promise<void> {
    const agent = this.safetyAgents.get(agentId);
    if (!agent) return;

    // In production, send push notification to agent dashboard
    sosLogger.info(
      { agentName: agent.name, type },
      "[SOSService] Notified agent",
    );
  }

  private async alertSeniorAgents(incident: SOSIncident): Promise<void> {
    for (const agent of this.safetyAgents.values()) {
      if (agent.role === "senior_agent" && agent.isOnDuty) {
        await this.notifyAgent(agent.id, "escalation_alert", incident);
      }
    }
  }

  private async alertManagers(incident: SOSIncident): Promise<void> {
    for (const agent of this.safetyAgents.values()) {
      if (agent.role === "manager") {
        await this.notifyAgent(agent.id, "critical_escalation", incident);
      }
    }
  }

  private async triggerAllHandsAlert(incident: SOSIncident): Promise<void> {
    for (const agent of this.safetyAgents.values()) {
      await this.notifyAgent(agent.id, "all_hands_alert", incident);
    }

    sosLogger.info(
      { incidentId: incident.id },
      "[SOSService] ALL HANDS ALERT for incident",
    );
  }

  private async initiateAgentCallback(
    incident: SOSIncident,
    agentId: string,
  ): Promise<void> {
    // In production, initiate call between agent and user
    this.addTimelineEntry(incident.id, "callback_initiated", { agentId });
    sosLogger.info(
      { incidentId: incident.id },
      "[SOSService] Callback initiated",
    );
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  async getActiveSOSForUser(userId: string): Promise<SOSIncident | null> {
    for (const incident of this.activeIncidents.values()) {
      if (incident.userId === userId && incident.status === "ACTIVE") {
        return incident;
      }
    }
    return null;
  }

  async getIncident(incidentId: string): Promise<SOSIncident | null> {
    return this.activeIncidents.get(incidentId) || null;
  }

  async getIncidentTimeline(incidentId: string): Promise<SOSTimelineEntry[]> {
    return this.incidentTimelines.get(incidentId) || [];
  }

  async updateIncidentLocation(
    incidentId: string,
    location: Location,
  ): Promise<void> {
    const incident = this.activeIncidents.get(incidentId);
    if (incident) {
      incident.currentLocation = location;
    }
  }

  async getActiveIncidentsCount(): Promise<number> {
    return this.activeIncidents.size;
  }

  async getActiveIncidents(): Promise<SOSIncident[]> {
    return Array.from(this.activeIncidents.values());
  }

  async getAgentActiveIncidents(agentId: string): Promise<SOSIncident[]> {
    const incidents: SOSIncident[] = [];

    for (const [incidentId, assignedAgent] of this.agentAssignments) {
      if (assignedAgent === agentId) {
        const incident = this.activeIncidents.get(incidentId);
        if (incident) {
          incidents.push(incident);
        }
      }
    }

    return incidents;
  }

  private addTimelineEntry(
    incidentId: string,
    type: string,
    data: Record<string, any>,
  ): void {
    const timeline = this.incidentTimelines.get(incidentId) || [];
    timeline.push({
      id: this.generateId(),
      type,
      data,
      timestamp: new Date(),
    });
    this.incidentTimelines.set(incidentId, timeline);
  }

  private async getUserEmergencyContacts(
    userId: string,
  ): Promise<EmergencyContact[]> {
    // Query database for user's emergency contacts
    try {
      const contacts = await this.getContactsFromDatabase(userId);
      return contacts;
    } catch (error) {
      sosLogger.error(
        { userId, error },
        "Failed to fetch emergency contacts from database",
      );
      // Return empty array if database query fails
      return [];
    }
  }

  /**
   * Get emergency contacts from database
   */
  private async getContactsFromDatabase(
    userId: string,
  ): Promise<EmergencyContact[]> {
    // Import prisma client - in production this would be injected
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    try {
      const dbContacts = await prisma.emergencyContact.findMany({
        where: { userId, isActive: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });

      return dbContacts.map((c: any) => ({
        id: c.id,
        userId: c.userId,
        name: c.name,
        phoneNumber: c.phoneNumber,
        relationship: c.relationship || undefined,
        isPrimary: c.isPrimary,
        whatsappEnabled: c.whatsappEnabled ?? false,
        telegramEnabled: c.telegramEnabled ?? false,
        emailEnabled: c.emailEnabled ?? false,
        email: c.email || undefined,
        notifyOnTrip: c.notifyOnTrip ?? true,
        isVerified: c.isVerified ?? false,
      }));
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Add an emergency contact for a user
   */
  async addEmergencyContact(
    userId: string,
    contact: Omit<EmergencyContact, "id" | "userId" | "isVerified">,
  ): Promise<EmergencyContact> {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    try {
      // If this is set as primary, unset other primary contacts
      if (contact.isPrimary) {
        await prisma.emergencyContact.updateMany({
          where: { userId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const created = await prisma.emergencyContact.create({
        data: {
          userId,
          name: contact.name,
          phoneNumber: contact.phoneNumber,
          relationship: contact.relationship,
          isPrimary: contact.isPrimary,
          whatsappEnabled: contact.whatsappEnabled,
          telegramEnabled: contact.telegramEnabled,
          emailEnabled: contact.emailEnabled,
          email: contact.email,
          notifyOnTrip: contact.notifyOnTrip,
          isVerified: false,
          isActive: true,
        },
      });

      sosLogger.info(
        { userId, contactId: created.id },
        "Emergency contact added",
      );

      return {
        id: created.id,
        userId: created.userId,
        name: created.name,
        phoneNumber: created.phoneNumber,
        relationship: created.relationship || undefined,
        isPrimary: created.isPrimary,
        whatsappEnabled: created.whatsappEnabled ?? false,
        telegramEnabled: created.telegramEnabled ?? false,
        emailEnabled: created.emailEnabled ?? false,
        email: created.email || undefined,
        notifyOnTrip: created.notifyOnTrip ?? true,
        isVerified: created.isVerified ?? false,
      };
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Update an emergency contact
   */
  async updateEmergencyContact(
    userId: string,
    contactId: string,
    updates: Partial<Omit<EmergencyContact, "id" | "userId">>,
  ): Promise<EmergencyContact | null> {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    try {
      // Verify contact belongs to user
      const existing = await prisma.emergencyContact.findFirst({
        where: { id: contactId, userId },
      });

      if (!existing) {
        return null;
      }

      // If setting as primary, unset other primary contacts
      if (updates.isPrimary) {
        await prisma.emergencyContact.updateMany({
          where: { userId, isPrimary: true, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }

      const updated = await prisma.emergencyContact.update({
        where: { id: contactId },
        data: {
          name: updates.name,
          phoneNumber: updates.phoneNumber,
          relationship: updates.relationship,
          isPrimary: updates.isPrimary,
          whatsappEnabled: updates.whatsappEnabled,
          telegramEnabled: updates.telegramEnabled,
          emailEnabled: updates.emailEnabled,
          email: updates.email,
          notifyOnTrip: updates.notifyOnTrip,
        },
      });

      return {
        id: updated.id,
        userId: updated.userId,
        name: updated.name,
        phoneNumber: updated.phoneNumber,
        relationship: updated.relationship || undefined,
        isPrimary: updated.isPrimary,
        whatsappEnabled: updated.whatsappEnabled ?? false,
        telegramEnabled: updated.telegramEnabled ?? false,
        emailEnabled: updated.emailEnabled ?? false,
        email: updated.email || undefined,
        notifyOnTrip: updated.notifyOnTrip ?? true,
        isVerified: updated.isVerified ?? false,
      };
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Delete an emergency contact
   */
  async deleteEmergencyContact(
    userId: string,
    contactId: string,
  ): Promise<boolean> {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    try {
      // Soft delete - mark as inactive
      const result = await prisma.emergencyContact.updateMany({
        where: { id: contactId, userId },
        data: { isActive: false },
      });

      return result.count > 0;
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Get all emergency contacts for a user
   */
  async getEmergencyContacts(userId: string): Promise<EmergencyContact[]> {
    return this.getUserEmergencyContacts(userId);
  }

  private async generateLiveLocationLink(_incidentId: string): Promise<string> {
    const token = crypto.randomBytes(16).toString("hex");
    return `https://ubi.app/sos/track/${token}`;
  }

  private async getUserCountry(_userId: string): Promise<string> {
    // In production, get from user profile
    return "NG";
  }

  private async verifyUserPin(_userId: string, pin: string): Promise<boolean> {
    // In production, verify against stored PIN hash
    return pin === "1234";
  }

  private async recordFalseAlarm(_userId: string): Promise<void> {
    // In production, update user's false alarm count
    sosLogger.info(
      { userId: _userId },
      "[SOSService] Recorded false alarm for user",
    );
  }

  private generateId(): string {
    return `sos_${crypto.randomBytes(12).toString("hex")}`;
  }

  private initializeMockAgents(): void {
    // In production, load from database
    const mockAgents: SafetyAgent[] = [
      {
        id: "agent_1",
        userId: "user_agent_1",
        name: "Sarah O.",
        email: "sarah@ubi.app",
        role: "agent",
        team: "sos_response",
        country: "NG",
        city: "Lagos",
        isOnDuty: true,
        activeIncidents: 0,
        maxIncidents: 5,
        totalResolved: 150,
        avgResponseTime: 45,
      },
      {
        id: "agent_2",
        userId: "user_agent_2",
        name: "John K.",
        email: "john@ubi.app",
        role: "senior_agent",
        team: "sos_response",
        country: "KE",
        city: "Nairobi",
        isOnDuty: true,
        activeIncidents: 0,
        maxIncidents: 3,
        totalResolved: 300,
        avgResponseTime: 30,
      },
      {
        id: "agent_3",
        userId: "user_agent_3",
        name: "Manager M.",
        email: "manager@ubi.app",
        role: "manager",
        team: "sos_response",
        isOnDuty: true,
        activeIncidents: 0,
        maxIncidents: 10,
        totalResolved: 500,
      },
    ];

    for (const agent of mockAgents) {
      this.safetyAgents.set(agent.id, agent);
    }
  }

  // ---------------------------------------------------------------------------
  // USER SAFETY CONTEXT
  // ---------------------------------------------------------------------------

  async getUserSafetyContext(userId: string): Promise<UserSafetyContext> {
    const contacts = await this.getUserEmergencyContacts(userId);

    return {
      userId,
      name: "User Name", // In production, fetch from user service
      phone: "+2341234567890",
      verificationLevel: "VERIFIED",
      riskLevel: "LOW",
      previousIncidents: 0,
      emergencyContacts: contacts,
    };
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface TriggerSOSParams {
  userId: string;
  tripId?: string;
  driverId?: string;
  triggerMethod: "button" | "voice" | "shake" | "auto" | "crash_detected";
  location: Location;
  batteryLevel?: number;
  networkType?: string;
}

interface SOSTimelineEntry {
  id: string;
  type: string;
  data: Record<string, any>;
  timestamp: Date;
}

interface AudioRecordingSession {
  id: string;
  incidentId: string;
  userId: string;
  url: string;
  startedAt: Date;
  endedAt?: Date;
  isActive: boolean;
}

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const sosEmergencyService = new SOSEmergencyService();
