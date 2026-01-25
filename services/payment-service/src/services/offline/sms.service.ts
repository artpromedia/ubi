// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - SMS BOOKING SERVICE
// =============================================================================
// SMS-based booking for basic phones and areas with limited USSD coverage
// Supports: BOOK, TRACK, CANCEL, BALANCE, HELP commands
// =============================================================================

import { logger } from "@/lib/logger";
import {
  GeoLocation,
  IncomingSMS,
  ISMSService,
  MessagePriority,
  OutgoingSMS,
  ParsedSMSCommand,
  SMSCommand,
  SMSTemplate,
} from "@/types/offline.types";
import { prisma } from "@ubi/database";
import { Redis } from "ioredis";
import { EventEmitter } from "node:events";

// Redis client for geocoding cache and rate limiting
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Phone number validation patterns for African markets
const PHONE_PATTERNS = {
  KE: /^(?:\+?254|0)?([17]\d{8})$/, // Kenya
  NG: /^(?:\+?234|0)?([789][01]\d{8})$/, // Nigeria
  GH: /^(?:\+?233|0)?([235]\d{8})$/, // Ghana
  ZA: /^(?:\+?27|0)?([6-8]\d{8})$/, // South Africa
  RW: /^(?:\+?250|0)?([78]\d{8})$/, // Rwanda
  UG: /^(?:\+?256|0)?(7\d{8})$/, // Uganda
};

// Normalize phone to E.164 format
function normalizePhone(phone: string): string {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replaceAll(/[^\d+]/g, "");

  // Try to detect country and normalize
  for (const [country, pattern] of Object.entries(PHONE_PATTERNS)) {
    const match = pattern.exec(cleaned);
    if (match) {
      const countryCode = {
        KE: "254",
        NG: "234",
        GH: "233",
        ZA: "27",
        RW: "250",
        UG: "256",
      }[country];
      return `+${countryCode}${match[1]}`;
    }
  }

  // Return with + if not already present
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

// =============================================================================
// SMS CONSTANTS
// =============================================================================

const MAX_SMS_LENGTH = 160; // GSM-7 single SMS
const SENDER_ID = "UBI";

// =============================================================================
// SMS COMMAND PATTERNS
// =============================================================================

const COMMAND_PATTERNS = {
  // BOOK TO <destination> [FROM <pickup>]
  BOOK: /^(?:BOOK|BUKA|WEKA|RESERVA)\s+(?:TO\s+)?(.+?)(?:\s+FROM\s+(.+))?$/i,

  // TRACK [<trip_id>]
  TRACK: /^(?:TRACK|FUATILIA|TRAC|STATUS)(?:\s+(\w+))?$/i,

  // CANCEL [<trip_id>]
  CANCEL: /^(?:CANCEL|GHAIRI|CANC|STOP)(?:\s+(\w+))?$/i,

  // BALANCE or BAL
  BALANCE: /^(?:BALANCE|BAL|SALIO|BAKIYE)$/i,

  // HELP [<topic>]
  HELP: /^(?:HELP|MSAADA|AIDE|\?)(?:\s+(.+))?$/i,

  // PRICE <pickup> TO <destination>
  PRICE: /^(?:PRICE|BEI|PRIX|EST)\s+(.+?)\s+(?:TO|->|KWA)\s+(.+)$/i,

  // REGISTER <name>
  REGISTER: /^(?:REGISTER|REG|JIANDIKISHE|SAJILI)\s+(.+)$/i,

  // FEEDBACK <message>
  FEEDBACK: /^(?:FEEDBACK|FB|MAONI)\s+(.+)$/i,

  // CONFIRM [<code>]
  CONFIRM: /^(?:CONFIRM|THIBITISHA|YES|NDIO)(?:\s+(\w+))?$/i,

  // DRIVER <plate_number>
  DRIVER: /^(?:DRIVER|DEREVA|CHAUFFEUR)\s+(.+)$/i,

  // HOME <address> or WORK <address>
  SET_HOME: /^(?:HOME|NYUMBANI)\s+(.+)$/i,
  SET_WORK: /^(?:WORK|KAZI|OFISI)\s+(.+)$/i,
};

// =============================================================================
// SMS SERVICE
// =============================================================================

export class SMSService implements ISMSService {
  private readonly eventEmitter: EventEmitter;

  // Pending confirmations (Redis in production)
  private readonly pendingConfirmations: Map<
    string,
    {
      action: string;
      data: Record<string, unknown>;
      expiresAt: Date;
    }
  > = new Map();

  // SMS Templates
  private readonly templates: Map<string, SMSTemplate> = new Map();

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.initializeTemplates();
  }

  // ===========================================================================
  // MAIN SMS HANDLER
  // ===========================================================================

  async handleIncomingSMS(sms: IncomingSMS): Promise<OutgoingSMS> {
    const startTime = Date.now();

    try {
      // Parse the command
      const command = this.parseCommand(sms.body);

      // Get user context
      const user = await this.getUserByPhone(sms.sender);
      const lang = user?.preferredLanguage || this.detectLanguage(sms.body);

      // Process based on command type
      let response: OutgoingSMS;

      switch (command.command) {
        case SMSCommand.BOOK:
          response = await this.handleBook(sms, command, user, lang);
          break;

        case SMSCommand.TRACK:
          response = await this.handleTrack(sms, user, lang);
          break;

        case SMSCommand.CANCEL:
          response = await this.handleCancel(sms, command, user, lang);
          break;

        case SMSCommand.BALANCE:
          response = await this.handleBalance(sms, user, lang);
          break;

        case SMSCommand.HELP:
          response = await this.handleHelp(sms, command, lang);
          break;

        case SMSCommand.PRICE:
          response = await this.handlePrice(sms, command, lang);
          break;

        case SMSCommand.REGISTER:
          response = await this.handleRegister(sms, command, lang);
          break;

        case SMSCommand.FEEDBACK:
          response = await this.handleFeedback(sms, command, user, lang);
          break;

        case SMSCommand.CONFIRM:
          response = await this.handleConfirm(sms, command, user, lang);
          break;

        case SMSCommand.DRIVER:
          response = await this.handleDriver(sms, command, lang);
          break;

        case SMSCommand.SET_HOME:
        case SMSCommand.SET_WORK:
          response = await this.handleSetPlace(sms, command, user, lang);
          break;

        default:
          response = await this.handleUnknown(sms, lang);
      }

      // Log the interaction
      this.eventEmitter.emit("sms:processed", {
        id: sms.id,
        sender: sms.sender,
        command: command.command,
        duration: Date.now() - startTime,
      });

      return response;
    } catch (error) {
      this.eventEmitter.emit("sms:error", {
        id: sms.id,
        sender: sms.sender,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return this.buildResponse(sms.sender, this.t("error.generic", "en"));
    }
  }

  // ===========================================================================
  // COMMAND PARSING
  // ===========================================================================

  parseCommand(body: string): ParsedSMSCommand {
    const text = body.trim();

    // Check each pattern
    for (const [command, pattern] of Object.entries(COMMAND_PATTERNS)) {
      const match = pattern.exec(text);
      if (match) {
        return {
          command: command as SMSCommand,
          args: match.slice(1).filter(Boolean),
          raw: text,
        };
      }
    }

    // Default to unknown
    return {
      command: SMSCommand.UNKNOWN,
      args: [],
      raw: text,
    };
  }

  // ===========================================================================
  // COMMAND HANDLERS
  // ===========================================================================

  private async handleBook(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    user: any,
    lang: string,
  ): Promise<OutgoingSMS> {
    const [destination, pickup] = command.args;

    if (!destination) {
      return this.buildResponse(
        sms.sender,
        this.t("book.format", lang),
        MessagePriority.HIGH,
      );
    }

    // Check if user is registered
    if (!user) {
      return this.buildResponse(
        sms.sender,
        this.t("error.not_registered", lang),
        MessagePriority.HIGH,
      );
    }

    // Geocode addresses
    const dropoffLocation = await this.geocodeAddress(destination);
    if (!dropoffLocation) {
      return this.buildResponse(
        sms.sender,
        this.t("error.address_not_found", lang, { address: destination }),
        MessagePriority.HIGH,
      );
    }

    let pickupLocation: { coords: GeoLocation; address: string } | null;

    if (pickup) {
      pickupLocation = await this.geocodeAddress(pickup);
      if (!pickupLocation) {
        return this.buildResponse(
          sms.sender,
          this.t("error.address_not_found", lang, { address: pickup }),
          MessagePriority.HIGH,
        );
      }
    } else {
      // Try to get user's current location or home
      pickupLocation = await this.getDefaultPickup(user.id);
      if (!pickupLocation) {
        return this.buildResponse(
          sms.sender,
          this.t("book.need_pickup", lang),
          MessagePriority.HIGH,
        );
      }
    }

    // Get fare estimate
    const estimate = await this.getFareEstimate(
      pickupLocation.coords,
      dropoffLocation.coords,
    );

    // Store pending booking and generate confirmation code
    const confirmCode = this.generateConfirmCode();
    this.pendingConfirmations.set(`${sms.sender}:${confirmCode}`, {
      action: "book",
      data: {
        userId: user.id,
        pickup: pickupLocation,
        dropoff: dropoffLocation,
        fareEstimate: estimate.fare,
        eta: estimate.eta,
      },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    // Send confirmation request
    return this.buildResponse(
      sms.sender,
      this.t("book.confirm", lang, {
        from: this.truncate(pickupLocation.address, 30),
        to: this.truncate(dropoffLocation.address, 30),
        fare: this.formatCurrency(estimate.fare, lang),
        eta: estimate.eta,
        code: confirmCode,
      }),
      MessagePriority.HIGH,
    );
  }

  private async handleTrack(
    sms: IncomingSMS,
    user: any,
    lang: string,
  ): Promise<OutgoingSMS> {
    if (!user) {
      return this.buildResponse(
        sms.sender,
        this.t("error.not_registered", lang),
        MessagePriority.HIGH,
      );
    }

    const trip = await this.getActiveTrip(user.id);

    if (!trip) {
      return this.buildResponse(
        sms.sender,
        this.t("track.no_active", lang),
        MessagePriority.NORMAL,
      );
    }

    const statusMessages: Record<string, string> = {
      searching: this.t("track.status.searching", lang),
      matched: this.t("track.status.matched", lang, {
        driver: trip.driverName,
        vehicle: trip.vehiclePlate,
        eta: trip.eta,
      }),
      arriving: this.t("track.status.arriving", lang, {
        driver: trip.driverName,
        vehicle: trip.vehiclePlate,
      }),
      in_progress: this.t("track.status.in_progress", lang, {
        eta: trip.etaToDestination,
      }),
    };

    return this.buildResponse(
      sms.sender,
      statusMessages[trip.status] || this.t("track.status.unknown", lang),
      MessagePriority.HIGH,
    );
  }

  private async handleCancel(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    user: any,
    lang: string,
  ): Promise<OutgoingSMS> {
    if (!user) {
      return this.buildResponse(
        sms.sender,
        this.t("error.not_registered", lang),
      );
    }

    const [tripId] = command.args;
    const trip = tripId
      ? await this.getTrip(tripId)
      : await this.getActiveTrip(user.id);

    if (!trip) {
      return this.buildResponse(sms.sender, this.t("cancel.no_trip", lang));
    }

    // Check if cancellation is allowed
    const canCancel = ["searching", "matched", "arriving"].includes(
      trip.status,
    );
    if (!canCancel) {
      return this.buildResponse(sms.sender, this.t("cancel.not_allowed", lang));
    }

    // Calculate cancellation fee if applicable
    const fee = this.calculateCancellationFee(trip);

    if (fee > 0) {
      // Store pending cancellation
      const confirmCode = this.generateConfirmCode();
      this.pendingConfirmations.set(`${sms.sender}:${confirmCode}`, {
        action: "cancel",
        data: { tripId: trip.id, fee },
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      return this.buildResponse(
        sms.sender,
        this.t("cancel.with_fee", lang, {
          fee: this.formatCurrency(fee, lang),
          code: confirmCode,
        }),
        MessagePriority.HIGH,
      );
    }

    // Cancel immediately if no fee
    await this.cancelTrip(trip.id, "user_cancelled");

    return this.buildResponse(
      sms.sender,
      this.t("cancel.success", lang),
      MessagePriority.HIGH,
    );
  }

  private async handleBalance(
    sms: IncomingSMS,
    user: any,
    lang: string,
  ): Promise<OutgoingSMS> {
    if (!user) {
      return this.buildResponse(
        sms.sender,
        this.t("error.not_registered", lang),
      );
    }

    const balance = await this.getWalletBalance(user.id);
    const recentTransactions = await this.getRecentTransactions(user.id, 3);

    let message = this.t("balance.current", lang, {
      amount: this.formatCurrency(balance, lang),
    });

    if (recentTransactions.length > 0) {
      message += "\n\n" + this.t("balance.recent", lang);
      for (const tx of recentTransactions) {
        const sign = tx.type === "credit" ? "+" : "-";
        message += `\n${sign}${this.formatCurrency(tx.amount, lang)} ${tx.description}`;
      }
    }

    return this.buildResponse(sms.sender, message);
  }

  private async handleHelp(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    lang: string,
  ): Promise<OutgoingSMS> {
    const [topic] = command.args;

    if (topic) {
      const helpTopics: Record<string, string> = {
        book: this.t("help.book", lang),
        track: this.t("help.track", lang),
        cancel: this.t("help.cancel", lang),
        balance: this.t("help.balance", lang),
        price: this.t("help.price", lang),
      };

      const helpText = helpTopics[topic.toLowerCase()];
      if (helpText) {
        return this.buildResponse(sms.sender, helpText);
      }
    }

    // General help
    return this.buildResponse(
      sms.sender,
      this.t("help.general", lang),
      MessagePriority.LOW,
    );
  }

  private async handlePrice(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    lang: string,
  ): Promise<OutgoingSMS> {
    const [pickup, destination] = command.args;

    if (!pickup || !destination) {
      return this.buildResponse(sms.sender, this.t("price.format", lang));
    }

    const pickupLocation = await this.geocodeAddress(pickup);
    const dropoffLocation = await this.geocodeAddress(destination);

    if (!pickupLocation || !dropoffLocation) {
      return this.buildResponse(
        sms.sender,
        this.t("error.address_not_found", lang, {
          address: pickupLocation ? destination : pickup,
        }),
      );
    }

    const estimate = await this.getFareEstimate(
      pickupLocation.coords,
      dropoffLocation.coords,
    );

    return this.buildResponse(
      sms.sender,
      this.t("price.result", lang, {
        from: this.truncate(pickupLocation.address, 25),
        to: this.truncate(dropoffLocation.address, 25),
        fare: this.formatCurrency(estimate.fare, lang),
        distance: estimate.distance,
        eta: estimate.eta,
      }),
    );
  }

  private async handleRegister(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    lang: string,
  ): Promise<OutgoingSMS> {
    const [name] = command.args;

    if (!name || name.length < 2) {
      return this.buildResponse(sms.sender, this.t("register.format", lang));
    }

    const existing = await this.getUserByPhone(sms.sender);
    if (existing) {
      return this.buildResponse(
        sms.sender,
        this.t("register.already_registered", lang, { name: existing.name }),
      );
    }

    // Create user
    await this.createUser({
      phoneNumber: sms.sender,
      name: name.trim(),
      preferredLanguage: lang,
    });

    return this.buildResponse(
      sms.sender,
      this.t("register.success", lang, { name: name.trim() }),
      MessagePriority.HIGH,
    );
  }

  private async handleFeedback(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    _user: any,
    lang: string,
  ): Promise<OutgoingSMS> {
    const [message] = command.args;

    if (!message || message.length < 5) {
      return this.buildResponse(sms.sender, this.t("feedback.format", lang));
    }

    await this.submitFeedback({
      userId: _user?.id,
      phoneNumber: sms.sender,
      message: message,
      source: "sms",
    });

    return this.buildResponse(
      sms.sender,
      this.t("feedback.thanks", lang),
      MessagePriority.LOW,
    );
  }

  private async handleConfirm(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    _user: any,
    lang: string,
  ): Promise<OutgoingSMS> {
    const [code] = command.args;

    // Find pending confirmation
    const confirmKey = code
      ? `${sms.sender}:${code.toUpperCase()}`
      : Array.from(this.pendingConfirmations.keys()).find((k) =>
          k.startsWith(sms.sender),
        );

    if (!confirmKey) {
      return this.buildResponse(sms.sender, this.t("confirm.no_pending", lang));
    }

    const pending = this.pendingConfirmations.get(confirmKey);
    if (!pending || pending.expiresAt < new Date()) {
      this.pendingConfirmations.delete(confirmKey);
      return this.buildResponse(sms.sender, this.t("confirm.expired", lang));
    }

    // Process the pending action
    this.pendingConfirmations.delete(confirmKey);

    switch (pending.action) {
      case "book":
        return this.processBookingConfirmation(sms, pending.data, lang);

      case "cancel":
        return this.processCancellationConfirmation(sms, pending.data, lang);

      default:
        return this.buildResponse(sms.sender, this.t("confirm.unknown", lang));
    }
  }

  private async handleDriver(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    lang: string,
  ): Promise<OutgoingSMS> {
    const [plateNumber] = command.args;

    if (!plateNumber) {
      return this.buildResponse(sms.sender, this.t("driver.format", lang));
    }

    const driver = await this.getDriverByPlate(plateNumber.toUpperCase());

    if (!driver) {
      return this.buildResponse(sms.sender, this.t("driver.not_found", lang));
    }

    return this.buildResponse(
      sms.sender,
      this.t("driver.info", lang, {
        name: driver.name,
        plate: driver.vehiclePlate,
        rating: driver.rating.toFixed(1),
        trips: driver.totalTrips,
      }),
    );
  }

  private async handleSetPlace(
    sms: IncomingSMS,
    command: ParsedSMSCommand,
    user: any,
    lang: string,
  ): Promise<OutgoingSMS> {
    if (!user) {
      return this.buildResponse(
        sms.sender,
        this.t("error.not_registered", lang),
      );
    }

    const [address] = command.args;
    const placeType = command.command === SMSCommand.SET_HOME ? "home" : "work";

    const location = await this.geocodeAddress(address || "");
    if (!location) {
      return this.buildResponse(
        sms.sender,
        this.t("error.address_not_found", lang, { address: address || "" }),
      );
    }

    await this.savePlace(user.id, {
      type: placeType,
      name: placeType === "home" ? "Home" : "Work",
      address: location.address,
      coords: location.coords,
    });

    return this.buildResponse(
      sms.sender,
      this.t(`place.${placeType}_saved`, lang, {
        address: this.truncate(location.address, 40),
      }),
    );
  }

  private async handleUnknown(
    sms: IncomingSMS,
    lang: string,
  ): Promise<OutgoingSMS> {
    return this.buildResponse(
      sms.sender,
      this.t("error.unknown_command", lang),
      MessagePriority.LOW,
    );
  }

  // ===========================================================================
  // CONFIRMATION HANDLERS
  // ===========================================================================

  private async processBookingConfirmation(
    sms: IncomingSMS,
    data: Record<string, unknown>,
    lang: string,
  ): Promise<OutgoingSMS> {
    try {
      const trip = await this.createTrip({
        userId: data.userId as string,
        pickup: data.pickup as { coords: GeoLocation; address: string },
        dropoff: data.dropoff as { coords: GeoLocation; address: string },
        fareEstimate: data.fareEstimate as number,
        source: "sms",
      });

      return this.buildResponse(
        sms.sender,
        this.t("book.success", lang, {
          driver: trip.driverName,
          vehicle: trip.vehiclePlate,
          phone: trip.driverPhone,
          eta: trip.eta,
        }),
        MessagePriority.HIGH,
      );
    } catch (error) {
      console.error("SMS booking confirmation failed:", error);
      return this.buildResponse(
        sms.sender,
        this.t("error.no_drivers", lang),
        MessagePriority.HIGH,
      );
    }
  }

  private async processCancellationConfirmation(
    sms: IncomingSMS,
    data: Record<string, unknown>,
    lang: string,
  ): Promise<OutgoingSMS> {
    await this.cancelTrip(data.tripId as string, "user_cancelled");

    const fee = data.fee as number;
    if (fee > 0) {
      // Deduct cancellation fee
      await this.deductCancellationFee(sms.sender, fee);
    }

    return this.buildResponse(
      sms.sender,
      this.t("cancel.success", lang),
      MessagePriority.HIGH,
    );
  }

  // ===========================================================================
  // SMS BUILDING
  // ===========================================================================

  private buildResponse(
    recipient: string,
    message: string,
    priority: MessagePriority = MessagePriority.NORMAL,
  ): OutgoingSMS {
    // Split into multiple SMS if needed
    const parts = this.splitMessage(message);

    return {
      id: this.generateId(),
      recipient,
      sender: SENDER_ID,
      message: parts[0] || "",
      priority,
    };
  }

  private splitMessage(message: string): string[] {
    const encoding = this.detectEncoding(message);
    const maxLength = encoding === "gsm7" ? 160 : 70;
    const concatLength = encoding === "gsm7" ? 153 : 67;

    if (message.length <= maxLength) {
      return [message];
    }

    const parts: string[] = [];
    let remaining = message;

    while (remaining.length > 0) {
      if (parts.length === 0 && remaining.length <= maxLength) {
        parts.push(remaining);
        break;
      }

      parts.push(remaining.substring(0, concatLength));
      remaining = remaining.substring(concatLength);
    }

    return parts;
  }

  private detectEncoding(text: string): "gsm7" | "ucs2" {
    // GSM-7 character set (simplified check - includes basic Latin, common symbols, and GSM special chars)
    const gsm7Regex =
      /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[\]~|€]*$/;
    return gsm7Regex.test(text) ? "gsm7" : "ucs2";
  }

  // ===========================================================================
  // TEMPLATE SYSTEM
  // ===========================================================================

  async sendFromTemplate(
    templateId: string,
    recipient: string,
    variables: Record<string, string>,
    lang: string,
  ): Promise<OutgoingSMS> {
    const template =
      this.templates.get(`${templateId}_${lang}`) ||
      this.templates.get(`${templateId}_en`);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let body = template.template;
    for (const [key, value] of Object.entries(variables)) {
      body = body.replaceAll(`{${key}}`, value);
    }

    return this.buildResponse(recipient, body, template.priority);
  }

  private initializeTemplates(): void {
    const templateDefs: Array<{
      id: string;
      lang: string;
      template: string;
      priority?: MessagePriority;
    }> = [
      // Booking Templates
      {
        id: "booking_confirmed",
        lang: "en",
        template:
          "UBI: Ride booked! {driver} ({vehicle}) arriving in {eta}min. Call: {phone}. Track: Reply TRACK",
        priority: MessagePriority.HIGH,
      },
      {
        id: "booking_confirmed",
        lang: "sw",
        template:
          "UBI: Safari imewekwa! {driver} ({vehicle}) anafika kwa dakika {eta}. Piga: {phone}. Fuatilia: Jibu TRACK",
        priority: MessagePriority.HIGH,
      },
      {
        id: "driver_arriving",
        lang: "en",
        template:
          "UBI: {driver} is arriving now in {vehicle}. Look for the UBI sign!",
        priority: MessagePriority.HIGH,
      },
      {
        id: "trip_completed",
        lang: "en",
        template:
          "UBI: Trip completed! Fare: {fare}. Rate your driver: Reply 1-5 stars. Thank you for riding with UBI!",
        priority: MessagePriority.NORMAL,
      },
      {
        id: "trip_cancelled",
        lang: "en",
        template: "UBI: Your trip has been cancelled. {reason}",
        priority: MessagePriority.HIGH,
      },
      // Wallet Templates
      {
        id: "wallet_topup",
        lang: "en",
        template: "UBI: {amount} added to wallet. New balance: {balance}",
        priority: MessagePriority.NORMAL,
      },
      {
        id: "wallet_debit",
        lang: "en",
        template: "UBI: {amount} paid for trip. Balance: {balance}",
        priority: MessagePriority.NORMAL,
      },
      {
        id: "low_balance",
        lang: "en",
        template:
          "UBI: Low balance alert! Your balance is {balance}. Top up via M-Pesa or bank transfer.",
        priority: MessagePriority.LOW,
      },
    ];

    for (const def of templateDefs) {
      const content: Record<string, string> = {};
      content[def.lang] = def.template;

      const template: SMSTemplate = {
        id: `${def.id}_${def.lang}`,
        code: def.id,
        name: def.id,
        content,
        template: def.template,
        variables: this.extractVariables(def.template),
        language: def.lang,
        category: "notification",
        priority: def.priority || MessagePriority.NORMAL,
        maxLength: MAX_SMS_LENGTH,
      };
      this.templates.set(template.id, template);
    }
  }

  private extractVariables(template: string): string[] {
    const matches = template.match(/\{(\w+)\}/g) || [];
    return matches.map((m) => m.slice(1, -1));
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================

  private t(
    key: string,
    lang: string,
    params?: Record<string, unknown>,
  ): string {
    const translations = this.getTranslations(lang);
    let text = translations[key] || key;

    if (params) {
      for (const [param, value] of Object.entries(params)) {
        text = text.replaceAll(`{${param}}`, String(value));
      }
    }

    return text;
  }

  private getTranslations(lang: string): Record<string, string> {
    const translations: Record<string, Record<string, string>> = {
      en: {
        "book.format":
          "UBI: To book, send: BOOK TO <destination>\nExample: BOOK TO Westlands",
        "book.need_pickup":
          "UBI: Please include pickup. Send: BOOK TO <dest> FROM <pickup>\nOr set home: HOME <address>",
        "book.confirm":
          "UBI: Ride {from} -> {to}\nFare: {fare}, ETA: {eta}min\nReply CONFIRM {code} to book",
        "book.success":
          "UBI: Ride booked! {driver} ({vehicle}) arriving in {eta}min. Call: {phone}",
        "track.no_active":
          "UBI: No active ride. Send BOOK TO <destination> to book.",
        "track.status.searching":
          "UBI: Finding you a driver... You will receive an SMS when matched.",
        "track.status.matched":
          "UBI: Driver found! {driver} ({vehicle}) arriving in {eta}min",
        "track.status.arriving": "UBI: {driver} ({vehicle}) is arriving NOW!",
        "track.status.in_progress":
          "UBI: Trip in progress. Arriving in ~{eta}min",
        "track.status.unknown":
          "UBI: Unable to get trip status. Try again later.",
        "cancel.no_trip": "UBI: No active trip to cancel.",
        "cancel.not_allowed": "UBI: Cannot cancel - trip already in progress.",
        "cancel.with_fee":
          "UBI: Cancellation fee: {fee}. Reply CONFIRM {code} to cancel.",
        "cancel.success": "UBI: Trip cancelled successfully.",
        "balance.current": "UBI Wallet: {amount}",
        "balance.recent": "Recent:",
        "help.general":
          "UBI Commands:\nBOOK TO <place> - Book ride\nTRACK - Track ride\nCANCEL - Cancel ride\nBAL - Check balance\nHELP <topic> - More help",
        "help.book":
          "BOOK TO <destination>\nExample: BOOK TO CBD\nWith pickup: BOOK TO CBD FROM Westlands",
        "help.track": "Send TRACK to get your current ride status",
        "help.cancel": "Send CANCEL to cancel your current ride",
        "help.balance": "Send BAL to check your wallet balance",
        "help.price": "PRICE <from> TO <to>\nExample: PRICE Westlands TO CBD",
        "price.format":
          "UBI: Send: PRICE <from> TO <to>\nExample: PRICE Westlands TO CBD",
        "price.result":
          "UBI: {from} -> {to}\nEst. Fare: {fare}\nDistance: {distance}km, ETA: {eta}min",
        "register.format":
          "UBI: Send: REGISTER <your name>\nExample: REGISTER John Doe",
        "register.success":
          "UBI: Welcome {name}! Your UBI account is ready.\nSend BOOK TO <place> to book your first ride.",
        "register.already_registered":
          "UBI: You're already registered as {name}. Send HELP for commands.",
        "feedback.format": "UBI: Send: FEEDBACK <your message>",
        "feedback.thanks":
          "UBI: Thank you for your feedback! We appreciate it.",
        "confirm.no_pending": "UBI: No pending action to confirm.",
        "confirm.expired": "UBI: Confirmation expired. Please try again.",
        "confirm.unknown": "UBI: Unknown action.",
        "driver.format":
          "UBI: Send: DRIVER <plate number>\nExample: DRIVER KDA123X",
        "driver.not_found": "UBI: Driver not found. Check the plate number.",
        "driver.info":
          "UBI Driver: {name}\nVehicle: {plate}\nRating: {rating}★ ({trips} trips)",
        "place.home_saved": "UBI: Home saved: {address}. Book rides faster!",
        "place.work_saved": "UBI: Work saved: {address}. Book rides faster!",
        "error.generic":
          "UBI: Something went wrong. Please try again or call 0800-UBI-HELP",
        "error.not_registered":
          "UBI: Please register first. Send: REGISTER <your name>",
        "error.address_not_found":
          'UBI: Could not find "{address}". Try a different name.',
        "error.no_drivers":
          "UBI: No drivers available now. Please try again in a few minutes.",
        "error.unknown_command":
          "UBI: Unknown command. Send HELP for available commands.",
      },
      sw: {
        "book.format":
          "UBI: Kutuma safari, tuma: BOOK TO <mahali>\nMfano: BOOK TO Westlands",
        "book.success":
          "UBI: Safari imewekwa! {driver} ({vehicle}) anafika kwa dakika {eta}. Piga: {phone}",
        "error.generic":
          "UBI: Kuna hitilafu. Jaribu tena au piga 0800-UBI-HELP",
      },
    };

    return translations[lang]
      ? { ...translations.en, ...translations[lang] }
      : translations.en;
  }

  private detectLanguage(text: string): string {
    // Simple language detection based on keywords
    const swahiliWords = ["nyumbani", "kazi", "safari", "gari", "pesa"];
    const lower = text.toLowerCase();

    if (swahiliWords.some((word) => lower.includes(word))) {
      return "sw";
    }

    return "en";
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
  }

  private formatCurrency(amount: number, lang: string): string {
    const currencies: Record<string, string> = {
      en: "KES ",
      sw: "KES ",
      yo: "₦",
    };
    return (
      (currencies[lang] || currencies.en) + Math.round(amount).toLocaleString()
    );
  }

  private generateId(): string {
    return `sms_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 2 + 9)}`;
  }

  private generateConfirmCode(): string {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  private calculateCancellationFee(trip: any): number {
    // Free cancellation within 2 minutes of booking
    const timeSinceBooking = Date.now() - trip.createdAt.getTime();
    if (timeSinceBooking < 2 * 60 * 1000) return 0;

    // Fee if driver is already en route
    if (trip.status === "arriving") return 100;
    if (trip.status === "matched") return 50;

    return 0;
  }

  // ===========================================================================
  // EXTERNAL SERVICE IMPLEMENTATIONS
  // ===========================================================================

  private async getUserByPhone(phone: string): Promise<any> {
    try {
      const normalizedPhone = normalizePhone(phone);
      const user = await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        include: {
          rider: {
            include: {
              savedPlaces: true,
            },
          },
          walletAccounts: {
            where: { accountType: "USER_WALLET" },
          },
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        name: user.firstName,
        fullName: `${user.firstName} ${user.lastName}`,
        phone: user.phone,
        preferredLanguage: user.language,
        currency: user.currency,
        riderId: user.rider?.id,
        savedPlaces: user.rider?.savedPlaces || [],
        walletId: user.walletAccounts?.[0]?.id,
      };
    } catch (error) {
      logger.error("Error fetching user by phone", { phone, error });
      return null;
    }
  }

  private async createUser(data: {
    phone: string;
    name: string;
    language?: string;
    country?: string;
  }): Promise<any> {
    try {
      const normalizedPhone = normalizePhone(data.phone);

      // Detect country from phone number
      let country = data.country || "NG";
      for (const [countryCode, pattern] of Object.entries(PHONE_PATTERNS)) {
        if (pattern.test(normalizedPhone)) {
          country = countryCode;
          break;
        }
      }

      const currencyMap: Record<string, any> = {
        NG: "NGN",
        KE: "KES",
        GH: "GHS",
        ZA: "ZAR",
        RW: "RWF",
        UG: "UGX",
      };

      const user = await prisma.user.create({
        data: {
          phone: normalizedPhone,
          email: `sms_${Date.now()}@placeholder.ubi`, // Placeholder until user provides email
          firstName: data.name.split(" ")[0],
          lastName: data.name.split(" ").slice(1).join(" ") || "",
          passwordHash: "", // SMS users don't have passwords initially
          language: data.language || "en",
          country,
          currency: currencyMap[country] || "NGN",
          phoneVerified: true, // Verified by SMS registration
          role: "RIDER",
          status: "ACTIVE",
          rider: {
            create: {
              referralCode: `UBI${Date.now().toString(36).toUpperCase()}`,
            },
          },
          walletAccounts: {
            create: {
              accountType: "USER_WALLET",
              currency: currencyMap[country] || "NGN",
            },
          },
        },
        include: {
          rider: true,
          walletAccounts: true,
        },
      });

      logger.info("Created new SMS user", {
        userId: user.id,
        phone: normalizedPhone,
      });

      return {
        id: user.id,
        name: user.firstName,
        fullName: `${user.firstName} ${user.lastName}`,
        phone: user.phone,
        preferredLanguage: user.language,
        riderId: user.rider?.id,
        walletId: user.walletAccounts?.[0]?.id,
      };
    } catch (error) {
      logger.error("Error creating user", { data, error });
      throw error;
    }
  }

  private async geocodeAddress(
    address: string,
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    try {
      // Check cache first
      const cacheKey = `geocode:${address.toLowerCase().trim()}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Common landmarks and areas for African cities
      const landmarks: Record<
        string,
        { lat: number; lng: number; address: string }
      > = {
        // Kenya - Nairobi
        westlands: {
          lat: -1.2673,
          lng: 36.8028,
          address: "Westlands, Nairobi",
        },
        cbd: { lat: -1.2864, lng: 36.8172, address: "CBD, Nairobi" },
        kilimani: { lat: -1.2911, lng: 36.7869, address: "Kilimani, Nairobi" },
        jkia: { lat: -1.3192, lng: 36.9275, address: "JKIA Airport, Nairobi" },
        karen: { lat: -1.3226, lng: 36.7109, address: "Karen, Nairobi" },
        kiambu: { lat: -1.1714, lng: 36.8356, address: "Kiambu Town" },
        // Nigeria - Lagos
        vi: { lat: 6.4281, lng: 3.4219, address: "Victoria Island, Lagos" },
        ikeja: { lat: 6.6018, lng: 3.3515, address: "Ikeja, Lagos" },
        lekki: { lat: 6.4698, lng: 3.5852, address: "Lekki, Lagos" },
        ikoyi: { lat: 6.4541, lng: 3.4361, address: "Ikoyi, Lagos" },
        yaba: { lat: 6.5095, lng: 3.3711, address: "Yaba, Lagos" },
        airport: {
          lat: 6.5774,
          lng: 3.3212,
          address: "Murtala Muhammed Airport, Lagos",
        },
        // Ghana - Accra
        "airport accra": {
          lat: 5.6052,
          lng: -0.1668,
          address: "Kotoka Airport, Accra",
        },
        osu: { lat: 5.5571, lng: -0.1818, address: "Osu, Accra" },
        "east legon": {
          lat: 5.6351,
          lng: -0.1517,
          address: "East Legon, Accra",
        },
      };

      const normalizedAddress = address.toLowerCase().trim();

      // Check for known landmarks
      for (const [landmark, location] of Object.entries(landmarks)) {
        if (normalizedAddress.includes(landmark)) {
          const result = {
            coords: { lat: location.lat, lng: location.lng },
            address: location.address,
          };
          await redis.setex(cacheKey, 86400, JSON.stringify(result)); // Cache for 24 hours
          return result;
        }
      }

      // Call external geocoding service (Google Maps, OpenCage, etc.)
      const geocodeUrl = process.env.GEOCODE_API_URL;
      if (geocodeUrl) {
        const response = await fetch(
          `${geocodeUrl}?address=${encodeURIComponent(address)}&key=${process.env.GEOCODE_API_KEY}`,
        );
        const data = await response.json();
        if (data.results?.[0]?.geometry?.location) {
          const result = {
            coords: {
              lat: data.results[0].geometry.location.lat,
              lng: data.results[0].geometry.location.lng,
            },
            address: data.results[0].formatted_address,
          };
          await redis.setex(cacheKey, 86400, JSON.stringify(result));
          return result;
        }
      }

      // Fallback: Try fuzzy matching with stored places
      const places = await prisma.savedPlace.findMany({
        where: {
          address: { contains: address, mode: "insensitive" },
        },
        take: 1,
      });

      if (places.length > 0) {
        const result = {
          coords: { lat: places[0].latitude, lng: places[0].longitude },
          address: places[0].address,
        };
        await redis.setex(cacheKey, 86400, JSON.stringify(result));
        return result;
      }

      return null;
    } catch (error) {
      logger.error("Error geocoding address", { address, error });
      return null;
    }
  }

  private async getDefaultPickup(
    userId: string,
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          rider: {
            include: {
              savedPlaces: {
                where: { type: "home" },
                take: 1,
              },
            },
          },
        },
      });

      const homePlace = user?.rider?.savedPlaces?.[0];
      if (homePlace) {
        return {
          coords: { lat: homePlace.latitude, lng: homePlace.longitude },
          address: homePlace.address,
        };
      }

      // Check last completed ride pickup location
      const lastRide = await prisma.ride.findFirst({
        where: { riderId: user?.rider?.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
      });

      if (lastRide) {
        return {
          coords: {
            lat: lastRide.pickupLatitude,
            lng: lastRide.pickupLongitude,
          },
          address: lastRide.pickupAddress,
        };
      }

      return null;
    } catch (error) {
      logger.error("Error getting default pickup", { userId, error });
      return null;
    }
  }

  private async getFareEstimate(
    pickup: GeoLocation,
    dropoff: GeoLocation,
  ): Promise<{
    fare: number;
    eta: number;
    distance: number;
    currency: string;
  }> {
    try {
      // Calculate distance using Haversine formula
      const R = 6371; // Earth's radius in km
      const dLat = ((dropoff.lat - pickup.lat) * Math.PI) / 180;
      const dLng = ((dropoff.lng - pickup.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((pickup.lat * Math.PI) / 180) *
          Math.cos((dropoff.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;

      // Pricing based on distance (configurable per market)
      const pricing = (await redis.hgetall("pricing:config")) || {};
      const baseFare = Number.parseFloat(pricing.baseFare) || 100;
      const perKm = Number.parseFloat(pricing.perKm) || 50;
      const perMinute = Number.parseFloat(pricing.perMinute) || 5;
      const currency = pricing.currency || "NGN";

      // Estimate travel time (assume 25 km/h average in city traffic)
      const estimatedMinutes = Math.ceil((distance / 25) * 60);

      // Calculate fare
      const fare = Math.round(
        baseFare + distance * perKm + estimatedMinutes * perMinute,
      );

      // Check for surge pricing
      const surgeKey = `surge:${Math.floor(pickup.lat * 100)}_${Math.floor(pickup.lng * 100)}`;
      const surgeMultiplier = Number.parseFloat(
        (await redis.get(surgeKey)) || "1.0",
      );

      return {
        fare: Math.round(fare * surgeMultiplier),
        eta: Math.ceil(estimatedMinutes),
        distance: Math.round(distance * 10) / 10,
        currency,
      };
    } catch (error) {
      logger.error("Error calculating fare estimate", {
        pickup,
        dropoff,
        error,
      });
      // Return fallback estimate
      return { fare: 500, eta: 15, distance: 5, currency: "NGN" };
    }
  }

  private async createTrip(data: {
    userId: string;
    riderId: string;
    pickupCoords: GeoLocation;
    pickupAddress: string;
    dropoffCoords: GeoLocation;
    dropoffAddress: string;
    fare: number;
    currency: string;
    paymentMethod?: string;
  }): Promise<any> {
    try {
      // Create the ride in pending state
      const ride = await prisma.ride.create({
        data: {
          riderId: data.riderId,
          status: "PENDING",
          rideType: "ECONOMY",
          pickupAddress: data.pickupAddress,
          pickupLatitude: data.pickupCoords.lat,
          pickupLongitude: data.pickupCoords.lng,
          dropoffAddress: data.dropoffAddress,
          dropoffLatitude: data.dropoffCoords.lat,
          dropoffLongitude: data.dropoffCoords.lng,
          estimatedFare: data.fare,
          currency: (data.currency as any) || "NGN",
          estimatedDistance: 0, // Will be calculated by ride service
          estimatedDuration: 0,
          paymentMethod: (data.paymentMethod as any) || "WALLET",
        },
      });

      // Emit event for ride matching service
      this.eventEmitter.emit("ride:requested", {
        rideId: ride.id,
        pickup: data.pickupCoords,
        dropoff: data.dropoffCoords,
      });

      // Find nearest available driver for ETA
      const nearestDriver = await prisma.driver.findFirst({
        where: {
          isOnline: true,
          isAvailable: true,
          currentLatitude: { not: null },
        },
        include: {
          user: true,
          vehicle: true,
        },
        orderBy: {
          lastLocationUpdate: "desc",
        },
      });

      return {
        id: ride.id,
        driverName: nearestDriver?.user?.firstName || "Finding driver...",
        vehiclePlate: nearestDriver?.vehicle?.plateNumber || "Pending",
        driverPhone: nearestDriver?.user?.phone || "",
        eta: 5, // Default ETA, will be updated by matching service
        status: ride.status,
      };
    } catch (error) {
      logger.error("Error creating trip", { data, error });
      throw error;
    }
  }

  private async getActiveTrip(userId: string): Promise<any> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { rider: true },
      });

      if (!user?.rider) return null;

      const activeRide = await prisma.ride.findFirst({
        where: {
          riderId: user.rider.id,
          status: {
            in: [
              "PENDING",
              "SEARCHING",
              "DRIVER_ASSIGNED",
              "DRIVER_ARRIVING",
              "DRIVER_ARRIVED",
              "IN_PROGRESS",
            ],
          },
        },
        include: {
          driver: {
            include: {
              user: true,
              vehicle: true,
            },
          },
        },
        orderBy: { requestedAt: "desc" },
      });

      if (!activeRide) return null;

      return {
        id: activeRide.id,
        status: activeRide.status.toLowerCase().replace("_", " "),
        driverName: activeRide.driver?.user?.firstName || "Finding driver...",
        vehiclePlate: activeRide.driver?.vehicle?.plateNumber || "Pending",
        driverPhone: activeRide.driver?.user?.phone || "",
        driverLocation: activeRide.driver
          ? {
              lat: activeRide.driver.currentLatitude,
              lng: activeRide.driver.currentLongitude,
            }
          : null,
        pickup: activeRide.pickupAddress,
        dropoff: activeRide.dropoffAddress,
        fare: Number(activeRide.estimatedFare),
        createdAt: activeRide.requestedAt,
      };
    } catch (error) {
      logger.error("Error getting active trip", { userId, error });
      return null;
    }
  }

  private async getTrip(tripId: string): Promise<any> {
    try {
      const ride = await prisma.ride.findUnique({
        where: { id: tripId },
        include: {
          driver: {
            include: {
              user: true,
              vehicle: true,
            },
          },
          rider: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!ride) return null;

      return {
        id: ride.id,
        status: ride.status.toLowerCase().replace("_", " "),
        driverName: ride.driver?.user?.firstName,
        vehiclePlate: ride.driver?.vehicle?.plateNumber,
        driverPhone: ride.driver?.user?.phone,
        riderPhone: ride.rider?.user?.phone,
        pickup: ride.pickupAddress,
        dropoff: ride.dropoffAddress,
        fare: Number(ride.estimatedFare),
        actualFare: ride.actualFare ? Number(ride.actualFare) : null,
        createdAt: ride.requestedAt,
        completedAt: ride.completedAt,
      };
    } catch (error) {
      logger.error("Error getting trip", { tripId, error });
      return null;
    }
  }

  private async cancelTrip(tripId: string, reason: string): Promise<void> {
    try {
      await prisma.ride.update({
        where: { id: tripId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: reason,
          cancelledBy: "rider",
        },
      });

      this.eventEmitter.emit("ride:cancelled", { rideId: tripId, reason });

      logger.info("Trip cancelled via SMS", { tripId, reason });
    } catch (error) {
      logger.error("Error cancelling trip", { tripId, reason, error });
      throw error;
    }
  }

  private async deductCancellationFee(
    phone: string,
    fee: number,
  ): Promise<void> {
    try {
      if (fee <= 0) return;

      const user = await this.getUserByPhone(phone);
      if (!user?.walletId) {
        logger.warn("No wallet found for cancellation fee deduction", {
          phone,
        });
        return;
      }

      // Create transaction for cancellation fee
      const idempotencyKey = `cancel_fee_${user.id}_${Date.now()}`;

      await prisma.$transaction(async (tx) => {
        // Debit user wallet
        await tx.walletAccount.update({
          where: { id: user.walletId },
          data: {
            balance: { decrement: fee },
            availableBalance: { decrement: fee },
          },
        });

        // Create transaction record
        const transaction = await tx.transaction.create({
          data: {
            idempotencyKey,
            transactionType: "RIDE_PAYMENT",
            status: "COMPLETED",
            amount: fee,
            currency: user.currency || "NGN",
            description: "Ride cancellation fee",
            completedAt: new Date(),
          },
        });

        // Create ledger entry
        await tx.ledgerEntry.create({
          data: {
            transactionId: transaction.id,
            accountId: user.walletId,
            entryType: "DEBIT",
            amount: fee,
            balanceAfter: 0, // Will be calculated
            description: "Cancellation fee",
          },
        });
      });

      logger.info("Cancellation fee deducted", { phone, fee });
    } catch (error) {
      logger.error("Error deducting cancellation fee", { phone, fee, error });
    }
  }

  private async getWalletBalance(userId: string): Promise<number> {
    try {
      const wallet = await prisma.walletAccount.findFirst({
        where: {
          userId,
          accountType: "USER_WALLET",
        },
      });

      return wallet ? Number(wallet.availableBalance) : 0;
    } catch (error) {
      logger.error("Error getting wallet balance", { userId, error });
      return 0;
    }
  }

  private async getRecentTransactions(
    userId: string,
    limit: number,
  ): Promise<any[]> {
    try {
      const wallet = await prisma.walletAccount.findFirst({
        where: {
          userId,
          accountType: "USER_WALLET",
        },
      });

      if (!wallet) return [];

      const entries = await prisma.ledgerEntry.findMany({
        where: { accountId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          transaction: true,
        },
      });

      return entries.map((entry) => ({
        id: entry.id,
        type: entry.entryType,
        amount: Number(entry.amount),
        description: entry.description || entry.transaction?.description,
        date: entry.createdAt,
        balanceAfter: Number(entry.balanceAfter),
      }));
    } catch (error) {
      logger.error("Error getting recent transactions", {
        userId,
        limit,
        error,
      });
      return [];
    }
  }

  private async getDriverByPlate(plate: string): Promise<any> {
    try {
      const normalizedPlate = plate
        .toUpperCase()
        .replaceAll(/\s+/g, " ")
        .trim();

      const vehicle = await prisma.vehicle.findFirst({
        where: {
          plateNumber: { contains: normalizedPlate, mode: "insensitive" },
        },
        include: {
          drivers: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!vehicle || vehicle.drivers.length === 0) return null;

      const driver = vehicle.drivers[0];
      return {
        id: driver.id,
        name: driver.user.firstName,
        fullName: `${driver.user.firstName} ${driver.user.lastName}`,
        phone: driver.user.phone,
        rating: driver.rating,
        vehiclePlate: vehicle.plateNumber,
        vehicleModel: `${vehicle.make} ${vehicle.model}`,
        vehicleColor: vehicle.color,
      };
    } catch (error) {
      logger.error("Error getting driver by plate", { plate, error });
      return null;
    }
  }

  private async savePlace(
    userId: string,
    place: {
      name: string;
      address: string;
      coords: GeoLocation;
      type: "home" | "work" | "other";
    },
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { rider: true },
      });

      if (!user?.rider) {
        throw new Error("User is not a rider");
      }

      // Upsert saved place
      const existingPlace = await prisma.savedPlace.findFirst({
        where: {
          riderId: user.rider.id,
          type: place.type,
        },
      });

      if (existingPlace) {
        await prisma.savedPlace.update({
          where: { id: existingPlace.id },
          data: {
            name: place.name,
            address: place.address,
            latitude: place.coords.lat,
            longitude: place.coords.lng,
          },
        });
      } else {
        await prisma.savedPlace.create({
          data: {
            riderId: user.rider.id,
            name: place.name,
            address: place.address,
            latitude: place.coords.lat,
            longitude: place.coords.lng,
            type: place.type,
          },
        });
      }

      logger.info("Saved place for user", { userId, type: place.type });
    } catch (error) {
      logger.error("Error saving place", { userId, place, error });
      throw error;
    }
  }

  private async submitFeedback(data: {
    userId: string;
    tripId?: string;
    driverId?: string;
    rating?: number;
    message: string;
  }): Promise<void> {
    try {
      // If feedback is for a specific trip, update the ride rating
      if (data.tripId && data.rating) {
        await prisma.ride.update({
          where: { id: data.tripId },
          data: {
            driverRating: data.rating,
            notes: data.message,
          },
        });

        // Update driver's average rating
        if (data.driverId) {
          const driverRides = await prisma.ride.aggregate({
            where: {
              driverId: data.driverId,
              driverRating: { not: null },
            },
            _avg: { driverRating: true },
            _count: true,
          });

          if (driverRides._avg.driverRating) {
            await prisma.driver.update({
              where: { id: data.driverId },
              data: { rating: driverRides._avg.driverRating },
            });
          }
        }
      }

      // Store general feedback
      this.eventEmitter.emit("feedback:submitted", {
        userId: data.userId,
        tripId: data.tripId,
        rating: data.rating,
        message: data.message,
        source: "sms",
        timestamp: new Date(),
      });

      logger.info("Feedback submitted via SMS", {
        userId: data.userId,
        tripId: data.tripId,
      });
    } catch (error) {
      logger.error("Error submitting feedback", { data, error });
    }
  }

  // ===========================================================================
  // INTERFACE METHODS
  // ===========================================================================

  async handleIncoming(sms: IncomingSMS): Promise<void> {
    await this.handleIncomingSMS(sms);
  }

  async send(_sms: OutgoingSMS): Promise<string> {
    return this.generateId();
  }

  async sendTemplate(
    to: string,
    templateCode: string,
    data: Record<string, unknown>,
    language?: string,
  ): Promise<string> {
    const template = this.templates.get(`${templateCode}_${language || "en"}`);
    if (!template) {
      throw new Error(`Template not found: ${templateCode}`);
    }

    let message = template.template;
    for (const [key, value] of Object.entries(data)) {
      message = message.replaceAll(`{${key}}`, String(value));
    }

    return this.send({ message, recipient: to });
  }

  // parseCommand is already a public method defined earlier in the class

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default SMSService;
