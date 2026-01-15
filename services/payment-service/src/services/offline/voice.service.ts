// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - VOICE & CALL CENTER SERVICE
// =============================================================================
// IVR System + Call Center Integration for voice-based booking
// Supports: DTMF input, speech recognition, agent transfer
// =============================================================================

import { EventEmitter } from "events";

import {
  type AgentBookingRequest,
  AgentStatus,
  type CallCenterAgent,
  type GeoLocation,
  type IVRAction,
  IVRActionType,
  type IVRSession,
  IVRState,
} from "@/types/offline.types";

// =============================================================================
// IVR CONSTANTS
// =============================================================================

const _IVR_SESSION_TIMEOUT_MS = 300000; // 5 minutes
const MAX_RETRIES = 3;
const TTS_RATE = 0.9; // Slower for accessibility

// =============================================================================
// VOICE SERVICE
// =============================================================================

export class VoiceService {
  private eventEmitter: EventEmitter;

  // Sessions (Redis in production)
  private sessions: Map<string, IVRSession> = new Map();

  // Agent pool
  private agents: Map<string, CallCenterAgent> = new Map();

  // Agent queues by language
  private queues: Map<string, string[]> = new Map();

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.initializeAgents();
  }

  // ===========================================================================
  // IVR FLOW HANDLERS
  // ===========================================================================

  async handleIncomingCall(
    callSid: string,
    from: string,
    to: string,
  ): Promise<IVRAction[]> {
    const session = await this.createIVRSession(callSid, from, to);

    this.eventEmitter.emit("call:incoming", {
      callSid,
      from,
      to,
      sessionId: session.id,
    });

    // Check if user has active trip
    const user = await this.getUserByPhone(from);
    const activeTrip = user ? await this.getActiveTrip(user.id) : null;

    if (activeTrip) {
      // Fast-track to trip status
      session.state = IVRState.TRIP_STATUS;
      session.data = { tripId: activeTrip.id };
      await this.updateSession(session);
      return this.buildTripStatusActions(activeTrip, session.language);
    }

    // Welcome message and main menu
    return this.buildWelcomeActions(session);
  }

  async handleDTMFInput(callSid: string, digits: string): Promise<IVRAction[]> {
    const session = await this.getSession(callSid);
    if (!session) {
      return this.buildEndCallActions("Session expired");
    }

    // Track input
    session.inputHistory.push(digits);
    session.lastInput = digits;
    session.updatedAt = new Date();

    // Handle based on current state
    const actions = await this.processInput(session, digits);
    await this.updateSession(session);

    return actions;
  }

  async handleSpeechInput(
    callSid: string,
    transcript: string,
    confidence: number,
  ): Promise<IVRAction[]> {
    const session = await this.getSession(callSid);
    if (!session) {
      return this.buildEndCallActions("Session expired");
    }

    // Convert speech to DTMF-like command
    const normalizedInput = this.speechToCommand(transcript, session.state);

    session.inputHistory.push(`speech:${transcript}`);
    session.lastInput = normalizedInput;
    session.updatedAt = new Date();

    // If confidence is low, ask for confirmation
    if (confidence < 0.7) {
      return [
        this.speak(
          this.t("confirm.speech", session.language, { text: transcript }),
          session.language,
        ),
        this.gather("dtmf", 1, 5),
      ];
    }

    const actions = await this.processInput(session, normalizedInput);
    await this.updateSession(session);

    return actions;
  }

  async handleCallEnd(callSid: string): Promise<void> {
    const session = await this.getSession(callSid);
    if (session) {
      session.state = IVRState.ENDED;
      session.endedAt = new Date();
      await this.updateSession(session);

      this.eventEmitter.emit("call:ended", {
        callSid,
        duration: session.endedAt.getTime() - session.createdAt.getTime(),
        finalState: session.state,
      });
    }
  }

  // ===========================================================================
  // INPUT PROCESSING
  // ===========================================================================

  private async processInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    // Handle universal commands
    if (input === "0") {
      return this.handleGoBack(session);
    }
    if (input === "*") {
      return this.handleMainMenu(session);
    }
    if (input === "#") {
      return this.handleRepeat(session);
    }
    if (input === "9") {
      return this.handleTransferToAgent(session);
    }

    // Handle based on state
    switch (session.state) {
      case IVRState.WELCOME:
      case IVRState.MAIN_MENU:
        return this.handleMainMenuInput(session, input);

      case IVRState.LANGUAGE_SELECT:
        return this.handleLanguageInput(session, input);

      case IVRState.BOOK_RIDE:
        return this.handleBookRideInput(session, input);

      case IVRState.ENTER_PICKUP:
        return this.handlePickupInput(session, input);

      case IVRState.ENTER_DESTINATION:
        return this.handleDestinationInput(session, input);

      case IVRState.CONFIRM_BOOKING:
        return this.handleBookingConfirmation(session, input);

      case IVRState.TRIP_STATUS:
        return this.handleTripStatusInput(session, input);

      case IVRState.WALLET_MENU:
        return this.handleWalletMenuInput(session, input);

      case IVRState.HELP:
        return this.handleHelpInput(session, input);

      case IVRState.AWAITING_AGENT:
        return this.handleAwaitingAgentInput(session, input);

      default:
        return this.buildMainMenuActions(session);
    }
  }

  // ===========================================================================
  // MENU HANDLERS
  // ===========================================================================

  private buildWelcomeActions(session: IVRSession): IVRAction[] {
    session.state = IVRState.MAIN_MENU;

    return [
      this.speak(
        this.t("welcome.greeting", session.language),
        session.language,
      ),
      ...this.buildMainMenuActions(session),
    ];
  }

  private buildMainMenuActions(session: IVRSession): IVRAction[] {
    session.state = IVRState.MAIN_MENU;
    session.menuPath = ["MAIN"];

    return [
      this.speak(this.t("menu.main", session.language), session.language),
      this.gather("dtmf speech", 1, 10),
    ];
  }

  private async handleMainMenuInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    switch (input) {
      case "1": // Book a Ride
        session.state = IVRState.BOOK_RIDE;
        session.menuPath.push("BOOK");
        return [
          this.speak(
            this.t("book.method_prompt", session.language),
            session.language,
          ),
          this.gather("dtmf speech", 1, 10),
        ];

      case "2": // Track my Ride
        return this.handleTrackRide(session);

      case "3": // My Wallet
        session.state = IVRState.WALLET_MENU;
        session.menuPath.push("WALLET");
        const balance = await this.getWalletBalance(session.userId);
        return [
          this.speak(
            this.t("wallet.balance_and_menu", session.language, {
              amount: this.formatCurrency(balance, session.language),
            }),
            session.language,
          ),
          this.gather("dtmf", 1, 10),
        ];

      case "4": // Help
        session.state = IVRState.HELP;
        session.menuPath.push("HELP");
        return [
          this.speak(this.t("help.menu", session.language), session.language),
          this.gather("dtmf", 1, 10),
        ];

      case "5": // Change Language
        session.state = IVRState.LANGUAGE_SELECT;
        return [
          this.speak(
            this.t("language.prompt", session.language),
            session.language,
          ),
          this.gather("dtmf", 1, 10),
        ];

      default:
        session.retryCount = (session.retryCount || 0) + 1;
        if (session.retryCount >= MAX_RETRIES) {
          return this.handleTransferToAgent(session);
        }
        return [
          this.speak(
            this.t("error.invalid_option", session.language),
            session.language,
          ),
          ...this.buildMainMenuActions(session),
        ];
    }
  }

  private async handleLanguageInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const languages: Record<string, string> = {
      "1": "en",
      "2": "sw",
      "3": "yo",
      "4": "ha",
      "5": "fr",
      "6": "zu",
    };

    const lang = languages[input];
    if (lang) {
      session.language = lang;
      await this.updateUserLanguage(session.userId, lang);
      return [
        this.speak(this.t("language.changed", lang), lang),
        ...this.buildMainMenuActions(session),
      ];
    }

    return [
      this.speak(this.t("language.prompt", session.language), session.language),
      this.gather("dtmf", 1, 10),
    ];
  }

  // ===========================================================================
  // BOOKING FLOW
  // ===========================================================================

  private async handleBookRideInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    switch (input) {
      case "1": // Current Location
        const location = await this.getCurrentLocation(session.callerPhone);
        if (location) {
          session.data = session.data || {};
          session.data.pickup = location;
          session.state = IVRState.ENTER_DESTINATION;
          return [
            this.speak(
              this.t("book.pickup_set", lang, { address: location.address }),
              lang,
            ),
            this.speak(this.t("book.enter_destination", lang), lang),
            this.gather("speech", 1, 30),
          ];
        }
        // Fall through to manual entry
        session.state = IVRState.ENTER_PICKUP;
        return [
          this.speak(this.t("book.location_unavailable", lang), lang),
          this.speak(this.t("book.enter_pickup", lang), lang),
          this.gather("speech", 1, 30),
        ];

      case "2": // Home
        const home = await this.getSavedPlace(session.userId, "home");
        if (home) {
          session.data = { pickup: home };
          session.state = IVRState.ENTER_DESTINATION;
          return [
            this.speak(this.t("book.pickup_home", lang), lang),
            this.speak(this.t("book.enter_destination", lang), lang),
            this.gather("speech", 1, 30),
          ];
        }
        return [
          this.speak(this.t("book.no_home_saved", lang), lang),
          this.speak(this.t("book.enter_pickup", lang), lang),
          this.gather("speech", 1, 30),
        ];

      case "3": // Work
        const work = await this.getSavedPlace(session.userId, "work");
        if (work) {
          session.data = { pickup: work };
          session.state = IVRState.ENTER_DESTINATION;
          return [
            this.speak(this.t("book.pickup_work", lang), lang),
            this.speak(this.t("book.enter_destination", lang), lang),
            this.gather("speech", 1, 30),
          ];
        }
        return [
          this.speak(this.t("book.no_work_saved", lang), lang),
          this.speak(this.t("book.enter_pickup", lang), lang),
          this.gather("speech", 1, 30),
        ];

      case "4": // Speak address
        session.state = IVRState.ENTER_PICKUP;
        return [
          this.speak(this.t("book.enter_pickup", lang), lang),
          this.gather("speech", 1, 30),
        ];

      default:
        return [
          this.speak(this.t("book.method_prompt", lang), lang),
          this.gather("dtmf speech", 1, 10),
        ];
    }
  }

  private async handlePickupInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    // Try to geocode the spoken address
    const location = await this.geocodeAddress(input);

    if (!location) {
      session.retryCount = (session.retryCount || 0) + 1;
      if (session.retryCount >= MAX_RETRIES) {
        return this.handleTransferToAgent(session);
      }
      return [
        this.speak(this.t("error.address_not_found", lang), lang),
        this.speak(this.t("book.enter_pickup", lang), lang),
        this.gather("speech", 1, 30),
      ];
    }

    session.data = session.data || {};
    session.data.pickup = location;
    session.state = IVRState.ENTER_DESTINATION;
    session.retryCount = 0;

    return [
      this.speak(
        this.t("book.pickup_set", lang, { address: location.address }),
        lang,
      ),
      this.speak(this.t("book.enter_destination", lang), lang),
      this.gather("speech", 1, 30),
    ];
  }

  private async handleDestinationInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    // Handle quick destinations
    if (input === "home" || input === "1") {
      const home = await this.getSavedPlace(session.userId, "home");
      if (home) {
        return this.showBookingConfirmation(session, home);
      }
    }
    if (input === "work" || input === "2") {
      const work = await this.getSavedPlace(session.userId, "work");
      if (work) {
        return this.showBookingConfirmation(session, work);
      }
    }

    // Geocode the address
    const location = await this.geocodeAddress(input);

    if (!location) {
      session.retryCount = (session.retryCount || 0) + 1;
      if (session.retryCount >= MAX_RETRIES) {
        return this.handleTransferToAgent(session);
      }
      return [
        this.speak(this.t("error.address_not_found", lang), lang),
        this.speak(this.t("book.enter_destination", lang), lang),
        this.gather("speech", 1, 30),
      ];
    }

    return this.showBookingConfirmation(session, location);
  }

  private async showBookingConfirmation(
    session: IVRSession,
    dropoff: { coords: GeoLocation; address: string },
  ): Promise<IVRAction[]> {
    const lang = session.language;
    session.data = session.data || {};
    session.data.dropoff = dropoff;

    // Get fare estimate
    const pickup = session.data?.pickup as any;
    const estimate = await this.getFareEstimate(pickup?.coords, dropoff.coords);

    session.data = session.data || {};
    session.data.fareEstimate = estimate.fare;
    session.data.eta = estimate.eta;
    session.state = IVRState.CONFIRM_BOOKING;
    session.retryCount = 0;

    return [
      this.speak(
        this.t("book.confirm_details", lang, {
          from: pickup?.address,
          to: dropoff.address,
          fare: this.formatCurrency(estimate.fare, lang),
          eta: estimate.eta,
        }),
        lang,
      ),
      this.speak(this.t("book.confirm_prompt", lang), lang),
      this.gather("dtmf speech", 1, 10),
    ];
  }

  private async handleBookingConfirmation(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;
    const confirmYes = ["1", "yes", "ndio", "yebo", "oui", "ee"];
    const confirmNo = ["2", "no", "hapana", "non", "a'a"];

    if (confirmYes.includes(input.toLowerCase())) {
      try {
        const trip = await this.createTrip(session);
        session.data!.tripId = trip.id;
        session.state = IVRState.BOOKING_CONFIRMED;

        // Send SMS confirmation
        await this.sendSMSConfirmation(session.callerPhone, trip, lang);

        return [
          this.speak(
            this.t("book.success", lang, {
              driver: trip.driverName,
              vehicle: trip.vehiclePlate,
              eta: trip.eta,
            }),
            lang,
          ),
          this.speak(this.t("book.sms_sent", lang), lang),
          this.speak(this.t("book.thank_you", lang), lang),
          { type: IVRActionType.HANGUP },
        ];
      } catch (error) {
        return [
          this.speak(this.t("error.no_drivers", lang), lang),
          this.speak(this.t("error.try_again_later", lang), lang),
          this.gather("dtmf", 1, 10),
        ];
      }
    }

    if (confirmNo.includes(input.toLowerCase())) {
      session.state = IVRState.MAIN_MENU;
      session.data = {};
      return this.buildMainMenuActions(session);
    }

    return [
      this.speak(this.t("book.confirm_prompt", lang), lang),
      this.gather("dtmf speech", 1, 10),
    ];
  }

  // ===========================================================================
  // TRACKING
  // ===========================================================================

  private async handleTrackRide(session: IVRSession): Promise<IVRAction[]> {
    const lang = session.language;
    const trip = await this.getActiveTrip(session.userId);

    if (!trip) {
      return [
        this.speak(this.t("track.no_active", lang), lang),
        ...this.buildMainMenuActions(session),
      ];
    }

    session.state = IVRState.TRIP_STATUS;
    session.data = { tripId: trip.id };

    return this.buildTripStatusActions(trip, lang);
  }

  private buildTripStatusActions(trip: any, lang: string): IVRAction[] {
    const statusMessages: Record<string, string> = {
      searching: this.t("track.status.searching", lang),
      matched: this.t("track.status.matched", lang, {
        driver: trip.driverName,
        vehicle: trip.vehiclePlate,
        eta: trip.eta,
      }),
      arriving: this.t("track.status.arriving", lang, {
        driver: trip.driverName,
      }),
      in_progress: this.t("track.status.in_progress", lang, {
        eta: trip.etaToDestination,
      }),
    };

    return [
      this.speak(
        statusMessages[trip.status] || this.t("track.status.unknown", lang),
        lang,
      ),
      this.speak(this.t("track.options", lang), lang),
      this.gather("dtmf", 1, 10),
    ];
  }

  private async handleTripStatusInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    switch (input) {
      case "1": // Refresh
        const trip = await this.getTrip(
          session.data?.tripId as string | undefined,
        );
        if (trip) {
          return this.buildTripStatusActions(trip, lang);
        }
        return [
          this.speak(this.t("track.no_active", lang), lang),
          ...this.buildMainMenuActions(session),
        ];

      case "2": // Call driver
        const tripForDriver = await this.getTrip(
          session.data?.tripId as string | undefined,
        );
        if (tripForDriver?.driverPhone) {
          return [
            this.speak(this.t("track.connecting_driver", lang), lang),
            {
              type: IVRActionType.TRANSFER,
              payload: { number: tripForDriver.driverPhone },
            },
          ];
        }
        return [
          this.speak(this.t("track.no_driver_yet", lang), lang),
          ...this.buildTripStatusActions(tripForDriver!, lang),
        ];

      case "3": // Cancel
        return this.handleCancelTrip(session);

      default:
        return this.buildMainMenuActions(session);
    }
  }

  private async handleCancelTrip(session: IVRSession): Promise<IVRAction[]> {
    const lang = session.language;
    const trip = await this.getTrip(session.data?.tripId as string | undefined);

    if (!trip) {
      return this.buildMainMenuActions(session);
    }

    const fee = this.calculateCancellationFee(trip);

    if (fee > 0) {
      return [
        this.speak(
          this.t("cancel.with_fee", lang, {
            fee: this.formatCurrency(fee, lang),
          }),
          lang,
        ),
        this.speak(this.t("cancel.confirm_prompt", lang), lang),
        this.gather("dtmf", 1, 10),
      ];
    }

    await this.cancelTrip(trip.id, "user_cancelled");
    return [
      this.speak(this.t("cancel.success", lang), lang),
      ...this.buildMainMenuActions(session),
    ];
  }

  // ===========================================================================
  // WALLET
  // ===========================================================================

  private async handleWalletMenuInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    switch (input) {
      case "1": // Top Up
        return [
          this.speak(this.t("wallet.topup_instructions", lang), lang),
          { type: IVRActionType.HANGUP },
        ];

      case "2": // Recent transactions
        const transactions = await this.getRecentTransactions(
          session.userId!,
          3,
        );
        if (transactions.length === 0) {
          return [
            this.speak(this.t("wallet.no_transactions", lang), lang),
            ...this.buildMainMenuActions(session),
          ];
        }

        let txText = this.t("wallet.recent_header", lang);
        for (const tx of transactions) {
          const sign = tx.type === "credit" ? "+" : "-";
          txText += ` ${sign}${this.formatCurrency(tx.amount, lang)}, ${tx.description}.`;
        }

        return [
          this.speak(txText, lang),
          ...this.buildMainMenuActions(session),
        ];

      default:
        return this.buildMainMenuActions(session);
    }
  }

  // ===========================================================================
  // HELP & AGENT TRANSFER
  // ===========================================================================

  private async handleHelpInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    switch (input) {
      case "1": // Booking help
        return [
          this.speak(this.t("help.booking", lang), lang),
          this.gather("dtmf", 1, 10),
        ];

      case "2": // Payment help
        return [
          this.speak(this.t("help.payment", lang), lang),
          this.gather("dtmf", 1, 10),
        ];

      case "3": // Safety
        return [
          this.speak(this.t("help.safety", lang), lang),
          this.gather("dtmf", 1, 10),
        ];

      case "9": // Agent
        return this.handleTransferToAgent(session);

      default:
        return this.buildMainMenuActions(session);
    }
  }

  private async handleTransferToAgent(
    session: IVRSession,
  ): Promise<IVRAction[]> {
    const lang = session.language;
    session.state = IVRState.AWAITING_AGENT;

    // Find available agent for language
    const agent = await this.findAvailableAgent(lang);

    if (!agent) {
      // Queue the call
      const queuePosition = await this.queueCall(session);

      return [
        this.speak(
          this.t("agent.queue", lang, { position: queuePosition }),
          lang,
        ),
        this.speak(this.t("agent.hold_music", lang), lang),
        {
          type: IVRActionType.PLAY,
          payload: { url: "/audio/hold-music.mp3", loop: true },
        },
      ];
    }

    // Transfer to agent
    return this.transferToAgent(session, agent);
  }

  private async handleAwaitingAgentInput(
    session: IVRSession,
    input: string,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    if (input === "1") {
      // Stay in queue
      return [
        this.speak(this.t("agent.please_hold", lang), lang),
        {
          type: IVRActionType.PLAY,
          payload: { url: "/audio/hold-music.mp3", loop: true },
        },
      ];
    }

    if (input === "2") {
      // Request callback
      await this.requestCallback(session);
      return [
        this.speak(this.t("agent.callback_scheduled", lang), lang),
        { type: IVRActionType.HANGUP },
      ];
    }

    return this.buildMainMenuActions(session);
  }

  private async transferToAgent(
    session: IVRSession,
    agent: CallCenterAgent,
  ): Promise<IVRAction[]> {
    const lang = session.language;

    // Update agent status
    agent.status = AgentStatus.BUSY;
    agent.currentCallId = session.id;
    this.agents.set(agent.id, agent);

    // Log call assignment
    this.eventEmitter.emit("agent:assigned", {
      agentId: agent.id,
      sessionId: session.id,
      callerPhone: session.callerPhone,
    });

    session.state = IVRState.WITH_AGENT;
    session.agentId = agent.id;

    return [
      this.speak(this.t("agent.connecting", lang, { name: agent.name }), lang),
      {
        type: IVRActionType.TRANSFER,
        payload: {
          number: agent.extension,
          callerId: session.callerPhone,
          sipHeaders: {
            "X-Session-Id": session.id,
            "X-User-Id": session.userId || "",
            "X-Language": lang,
          },
        },
      },
    ];
  }

  // ===========================================================================
  // CALL CENTER AGENT BOOKING
  // ===========================================================================

  async handleAgentBooking(
    request: AgentBookingRequest,
  ): Promise<{ tripId: string }> {
    // Validate agent
    const agent = this.agents.get(request.agentId);
    if (!agent) {
      throw new Error("Invalid agent");
    }

    // Create trip on behalf of user
    const trip = await this.createTrip({
      userId: request.userId,
      pickup: {
        coords: request.pickup,
        address: request.pickupAddress,
      },
      dropoff: {
        coords: request.dropoff,
        address: request.dropoffAddress,
      },
      fareEstimate: request.fareEstimate,
      source: "call_center",
      agentId: agent.id,
    });

    // Send confirmation to user
    if (request.userPhone) {
      await this.sendSMSConfirmation(request.userPhone, trip, "en");
    }

    // Log agent booking
    this.eventEmitter.emit("agent:booking", {
      agentId: agent.id,
      tripId: trip.id,
      userId: request.userId,
    });

    return { tripId: trip.id };
  }

  // ===========================================================================
  // NAVIGATION HELPERS
  // ===========================================================================

  private async handleGoBack(session: IVRSession): Promise<IVRAction[]> {
    const parentStates: Record<string, IVRState> = {
      [IVRState.BOOK_RIDE]: IVRState.MAIN_MENU,
      [IVRState.ENTER_PICKUP]: IVRState.BOOK_RIDE,
      [IVRState.ENTER_DESTINATION]: IVRState.BOOK_RIDE,
      [IVRState.CONFIRM_BOOKING]: IVRState.ENTER_DESTINATION,
      [IVRState.WALLET_MENU]: IVRState.MAIN_MENU,
      [IVRState.HELP]: IVRState.MAIN_MENU,
      [IVRState.LANGUAGE_SELECT]: IVRState.MAIN_MENU,
    };

    session.state = parentStates[session.state] || IVRState.MAIN_MENU;
    session.menuPath.pop();

    return Promise.resolve(this.buildMainMenuActions(session));
  }

  private async handleMainMenu(session: IVRSession): Promise<IVRAction[]> {
    session.menuPath = [];
    session.data = {};
    return Promise.resolve(this.buildMainMenuActions(session));
  }

  private async handleRepeat(session: IVRSession): Promise<IVRAction[]> {
    // Re-process empty input to repeat current menu
    return this.processInput(session, "");
  }

  // ===========================================================================
  // ACTION BUILDERS
  // ===========================================================================

  private speak(text: string, language: string): IVRAction {
    return {
      type: IVRActionType.SPEAK,
      payload: {
        text,
        voice: this.getVoiceForLanguage(language),
        rate: TTS_RATE,
        language,
      },
    };
  }

  private gather(input: string, minDigits: number, timeout: number): IVRAction {
    return {
      type: IVRActionType.GATHER,
      payload: {
        input,
        numDigits: minDigits === 1 ? 1 : undefined,
        timeout,
        speechTimeout: "auto",
        finishOnKey: "#",
      },
    };
  }

  private buildEndCallActions(message: string): IVRAction[] {
    return [this.speak(message, "en"), { type: IVRActionType.HANGUP }];
  }

  private getVoiceForLanguage(lang: string): string {
    const voices: Record<string, string> = {
      en: "Polly.Joanna",
      sw: "Polly.Joanna", // Use English voice with Swahili pronunciation
      fr: "Polly.Lea",
      yo: "Polly.Joanna",
      ha: "Polly.Joanna",
      zu: "Polly.Joanna",
    };
    return voices[lang] || voices.en || "Polly.Joanna";
  }

  // ===========================================================================
  // SPEECH PROCESSING
  // ===========================================================================

  private speechToCommand(transcript: string, state: IVRState): string {
    const lower = transcript.toLowerCase().trim();

    // Universal commands
    if (["back", "rudi", "retour"].includes(lower)) {
      return "0";
    }
    if (["menu", "main menu", "menyu"].includes(lower)) {
      return "*";
    }
    if (["repeat", "rudia", "repete"].includes(lower)) {
      return "#";
    }
    if (["agent", "operator", "help me", "msaada"].includes(lower)) {
      return "9";
    }

    // State-specific conversions
    if (state === IVRState.MAIN_MENU) {
      if (
        ["book", "ride", "safari", "reserve"].some((w) => lower.includes(w))
      ) {
        return "1";
      }
      if (
        ["track", "fuatilia", "where", "status"].some((w) => lower.includes(w))
      ) {
        return "2";
      }
      if (
        ["wallet", "balance", "money", "pesa"].some((w) => lower.includes(w))
      ) {
        return "3";
      }
      if (["help", "msaada", "aide"].some((w) => lower.includes(w))) {
        return "4";
      }
    }

    if (state === IVRState.CONFIRM_BOOKING) {
      if (
        ["yes", "ndio", "oui", "confirm", "book"].some((w) => lower.includes(w))
      ) {
        return "1";
      }
      if (["no", "hapana", "non", "cancel"].some((w) => lower.includes(w))) {
        return "2";
      }
    }

    // Return original for address input
    return transcript;
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  async createIVRSession(
    callSid: string,
    from: string,
    to: string,
  ): Promise<IVRSession> {
    const user = await this.getUserByPhone(from);

    const session: IVRSession = {
      id: this.generateId(),
      callSid,
      callerPhone: from,
      calledNumber: to,
      userId: user?.id,
      state: IVRState.WELCOME,
      menuPath: [],
      language: user?.preferredLanguage || "en",
      inputHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + _IVR_SESSION_TIMEOUT_MS),
    };

    this.sessions.set(callSid, session);
    return session;
  }

  async getSession(callSid: string): Promise<IVRSession | null> {
    return this.sessions.get(callSid) || null;
  }

  async updateSession(session: IVRSession): Promise<void> {
    session.updatedAt = new Date();
    this.sessions.set(session.callSid, session);
  }

  // ===========================================================================
  // AGENT MANAGEMENT
  // ===========================================================================

  private initializeAgents(): void {
    // In production, load from database
    const agentDefs = [
      {
        id: "agent_1",
        name: "Sarah",
        languages: ["en", "sw"],
        extension: "+254700111111",
      },
      {
        id: "agent_2",
        name: "John",
        languages: ["en"],
        extension: "+254700111112",
      },
      {
        id: "agent_3",
        name: "Amina",
        languages: ["sw", "en"],
        extension: "+254700111113",
      },
      {
        id: "agent_4",
        name: "Adekunle",
        languages: ["yo", "en"],
        extension: "+254700111114",
      },
    ];

    for (const def of agentDefs) {
      const agent: CallCenterAgent = {
        id: def.id,
        employeeId: def.id,
        name: def.name,
        email: `${def.id}@ubi.com`,
        phone: def.extension,
        extension: def.extension,
        languages: def.languages,
        status: AgentStatus.AVAILABLE,
        skills: ["booking", "support"],
        currentCallId: undefined,
        currentCalls: 0,
        maxCalls: 3,
        shiftsThisWeek: 5,
        rating: 4.5,
      };
      this.agents.set(agent.id, agent);
    }
  }

  private async findAvailableAgent(
    language: string,
  ): Promise<CallCenterAgent | null> {
    for (const agent of this.agents.values()) {
      if (
        agent.status === AgentStatus.AVAILABLE &&
        agent.languages.includes(language)
      ) {
        return agent;
      }
    }

    // Fallback to any English-speaking agent
    if (language !== "en") {
      for (const agent of this.agents.values()) {
        if (
          agent.status === AgentStatus.AVAILABLE &&
          agent.languages.includes("en")
        ) {
          return agent;
        }
      }
    }

    return null;
  }

  private async queueCall(session: IVRSession): Promise<number> {
    const queueKey = session.language;
    const queue = this.queues.get(queueKey) || [];
    queue.push(session.id);
    this.queues.set(queueKey, queue);
    return queue.length;
  }

  private async requestCallback(session: IVRSession): Promise<void> {
    this.eventEmitter.emit("callback:requested", {
      sessionId: session.id,
      phone: session.callerPhone,
      language: session.language,
      requestedAt: new Date(),
    });
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
        "welcome.greeting": "Welcome to UBI, your smart ride service.",
        "menu.main":
          "Press 1 to book a ride. Press 2 to track your ride. Press 3 for wallet. Press 4 for help. Press 5 to change language. Or say what you need.",
        "book.method_prompt":
          "Press 1 for current location. Press 2 for home. Press 3 for work. Press 4 to speak your pickup address.",
        "book.enter_pickup": "Please say your pickup address.",
        "book.enter_destination": "Please say your destination.",
        "book.pickup_set": "Pickup set to {address}.",
        "book.pickup_home": "Pickup set to your home address.",
        "book.pickup_work": "Pickup set to your work address.",
        "book.location_unavailable": "Could not detect your location.",
        "book.no_home_saved": "No home address saved.",
        "book.no_work_saved": "No work address saved.",
        "book.confirm_details":
          "Your ride from {from} to {to}. Estimated fare {fare}. Driver arriving in {eta} minutes.",
        "book.confirm_prompt": "Press 1 to confirm, or 2 to cancel.",
        "book.success":
          "Ride confirmed! {driver} will arrive in {eta} minutes in a {vehicle}.",
        "book.sms_sent": "You will receive a text message with the details.",
        "book.thank_you": "Thank you for using UBI. Have a safe trip!",
        "track.no_active": "You have no active rides.",
        "track.status.searching": "We are finding you a driver. Please wait.",
        "track.status.matched":
          "{driver} has been assigned. They will arrive in {eta} minutes in a {vehicle}.",
        "track.status.arriving":
          "{driver} is arriving now. Please look for your driver.",
        "track.status.in_progress":
          "Your trip is in progress. You will arrive in approximately {eta} minutes.",
        "track.status.unknown": "Unable to get trip status.",
        "track.options":
          "Press 1 to refresh. Press 2 to call your driver. Press 3 to cancel. Press star for main menu.",
        "track.connecting_driver": "Connecting you to your driver.",
        "track.no_driver_yet": "No driver assigned yet. Please wait.",
        "wallet.balance_and_menu":
          "Your wallet balance is {amount}. Press 1 to add money. Press 2 for recent transactions.",
        "wallet.topup_instructions":
          "To add money, please use M-Pesa paybill number 123456. Your account number is your phone number.",
        "wallet.no_transactions": "No recent transactions.",
        "wallet.recent_header": "Your recent transactions:",
        "cancel.with_fee":
          "Cancellation fee is {fee}. Press 1 to confirm cancellation, or 2 to keep your ride.",
        "cancel.success": "Your ride has been cancelled.",
        "cancel.confirm_prompt": "Press 1 to confirm, or 2 to go back.",
        "language.prompt":
          "Press 1 for English. Press 2 for Swahili. Press 3 for Yoruba. Press 4 for Hausa. Press 5 for French.",
        "language.changed": "Language has been changed.",
        "help.menu":
          "Press 1 for booking help. Press 2 for payment help. Press 3 for safety information. Press 9 to speak to an agent.",
        "help.booking":
          "To book a ride, press 1 from the main menu and follow the prompts. You can speak your address or use saved locations.",
        "help.payment":
          "We accept M-Pesa, card payments, and UBI wallet. Your fare is charged when the trip is complete.",
        "help.safety":
          "For emergencies, press the SOS button in the app or call 999. All our drivers are verified.",
        "agent.queue":
          "All agents are busy. You are number {position} in the queue.",
        "agent.hold_music": "Please hold.",
        "agent.please_hold": "Please continue to hold.",
        "agent.callback_scheduled": "We will call you back within 30 minutes.",
        "agent.connecting": "Connecting you to {name}.",
        "confirm.speech": "Did you say {text}? Press 1 for yes, 2 for no.",
        "error.invalid_option": "Invalid option.",
        "error.address_not_found":
          "Sorry, I could not find that address. Please try again.",
        "error.no_drivers": "Sorry, no drivers are available right now.",
        "error.try_again_later":
          "Please try again in a few minutes, or press 9 to speak to an agent.",
      },
      sw: {
        "welcome.greeting": "Karibu UBI, huduma yako ya usafiri.",
        "menu.main":
          "Bonyeza 1 kupata safari. Bonyeza 2 kufuatilia safari. Bonyeza 3 kwa mkoba. Bonyeza 4 kwa msaada.",
        "book.success":
          "Safari imethibitishwa! {driver} atafika kwa dakika {eta}.",
        "error.invalid_option": "Chaguo batili.",
      },
    };

    return { ...translations.en, ...(translations[lang] || {}) };
  }

  private formatCurrency(amount: number, _lang: string): string {
    return "KES " + Math.round(amount).toLocaleString();
  }

  private calculateCancellationFee(trip: any): number {
    if (trip.status === "arriving") {
      return 100;
    }
    if (trip.status === "matched") {
      return 50;
    }
    return 0;
  }

  private generateId(): string {
    return `ivr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===========================================================================
  // EXTERNAL SERVICE STUBS
  // ===========================================================================

  private async getUserByPhone(_phone: string): Promise<any> {
    return { id: "user_123", preferredLanguage: "en" };
  }

  private async getCurrentLocation(_phone: string): Promise<any> {
    return null;
  }

  private async geocodeAddress(
    address: string,
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    return { coords: { lat: -1.2921, lng: 36.8219 }, address };
  }

  private async getSavedPlace(_userId?: string, _type?: string): Promise<any> {
    return null;
  }

  private async getFareEstimate(
    _pickup: GeoLocation,
    _dropoff: GeoLocation,
  ): Promise<any> {
    return { fare: 350, eta: 5 };
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

  private async getActiveTrip(_userId?: string): Promise<any> {
    return null;
  }

  private async getTrip(_tripId?: string): Promise<any> {
    return null;
  }

  private async cancelTrip(_tripId: string, _reason: string): Promise<void> {}

  private async getWalletBalance(_userId?: string): Promise<number> {
    return 1500;
  }

  private async getRecentTransactions(
    _userId: string,
    _limit: number,
  ): Promise<any[]> {
    return [];
  }

  private async updateUserLanguage(
    _userId?: string,
    _lang?: string,
  ): Promise<void> {}

  private async sendSMSConfirmation(
    _phone: string,
    _trip: any,
    _lang: string,
  ): Promise<void> {}

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default VoiceService;
