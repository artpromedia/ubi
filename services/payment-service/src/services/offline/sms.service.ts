// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - SMS BOOKING SERVICE
// =============================================================================
// SMS-based booking for basic phones and areas with limited USSD coverage
// Supports: BOOK, TRACK, CANCEL, BALANCE, HELP commands
// =============================================================================

import { EventEmitter } from "events";

import {
  type GeoLocation,
  type IncomingSMS,
  type ISMSService,
  MessagePriority,
  type OutgoingSMS,
  type ParsedSMSCommand,
  SMSCommand,
  type SMSTemplate,
} from "@/types/offline.types";

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
  private eventEmitter: EventEmitter;

  // Pending confirmations (Redis in production)
  private pendingConfirmations: Map<
    string,
    {
      action: string;
      data: Record<string, unknown>;
      expiresAt: Date;
    }
  > = new Map();

  // SMS Templates
  private templates: Map<string, SMSTemplate> = new Map();

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
      const match = text.match(pattern);
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
          address: !pickupLocation ? pickup : destination,
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
    // GSM-7 character set (simplified check)
    const gsm7Regex =
      /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-Z ÄÖÑÜ§¿a-zäöñüà\u000C^{}\\[~\]|€]*$/;
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
      body = body.replace(new RegExp(`\\{${key}\\}`, "g"), value);
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
        text = text.replace(new RegExp(`\\{${param}\\}`, "g"), String(value));
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

    return { ...translations.en, ...(translations[lang] || {}) };
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
    if (text.length <= maxLength) {
      return text;
    }
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
    return `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateConfirmCode(): string {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  private calculateCancellationFee(trip: any): number {
    // Free cancellation within 2 minutes of booking
    const timeSinceBooking = Date.now() - trip.createdAt.getTime();
    if (timeSinceBooking < 2 * 60 * 1000) {
      return 0;
    }

    // Fee if driver is already en route
    if (trip.status === "arriving") {
      return 100;
    }
    if (trip.status === "matched") {
      return 50;
    }

    return 0;
  }

  // ===========================================================================
  // EXTERNAL SERVICE STUBS
  // ===========================================================================

  private async getUserByPhone(_phone: string): Promise<any> {
    return { id: "user_123", name: "John", preferredLanguage: "en" };
  }

  private async createUser(_data: any): Promise<any> {
    return { id: "user_" + Date.now(), ..._data };
  }

  private async geocodeAddress(
    address: string,
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    return { coords: { lat: -1.2921, lng: 36.8219 }, address };
  }

  private async getDefaultPickup(
    _userId: string,
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    return null;
  }

  private async getFareEstimate(
    _pickup: GeoLocation,
    _dropoff: GeoLocation,
  ): Promise<any> {
    return { fare: 350, eta: 5, distance: 7.2 };
  }

  private async createTrip(_data: any): Promise<any> {
    return {
      id: "trip_" + Date.now(),
      driverName: "John K.",
      vehiclePlate: "KDA 123X",
      driverPhone: "+254700123456",
      eta: 5,
    };
  }

  private async getActiveTrip(_userId: string): Promise<any> {
    return null;
  }

  private async getTrip(_tripId: string): Promise<any> {
    return null;
  }

  private async cancelTrip(_tripId: string, _reason: string): Promise<void> {}

  private async deductCancellationFee(
    _phone: string,
    _fee: number,
  ): Promise<void> {}

  private async getWalletBalance(_userId: string): Promise<number> {
    return 1500;
  }

  private async getRecentTransactions(
    _userId: string,
    _limit: number,
  ): Promise<any[]> {
    return [];
  }

  private async getDriverByPlate(_plate: string): Promise<any> {
    return null;
  }

  private async savePlace(_userId: string, _place: any): Promise<void> {}

  private async submitFeedback(_data: any): Promise<void> {}

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
      message = message.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
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
