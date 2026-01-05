// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - USSD GATEWAY SERVICE
// =============================================================================
// Full USSD booking flow supporting feature phones on 2G networks
// Target: 50M+ users via USSD, <3 second response times
// =============================================================================

import { EventEmitter } from "events";
import {
  GeoLocation,
  IUSSDService,
  USSDMenu,
  USSDRequest,
  USSDResponse,
  USSDSession,
  USSDState,
} from "../types/offline.types";

// =============================================================================
// USSD CONSTANTS
// =============================================================================

const USSD_SESSION_TIMEOUT_MS = 180000; // 3 minutes
const MAX_MESSAGE_LENGTH = 182; // USSD max characters
const MAX_GSM7_LENGTH = 160;

// =============================================================================
// USSD SERVICE
// =============================================================================

export class USSDService implements IUSSDService {
  private eventEmitter: EventEmitter;

  // Session storage (Redis in production)
  private sessions: Map<string, USSDSession> = new Map();

  // Menu definitions
  private menus: Map<string, USSDMenu> = new Map();

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.initializeMenus();
  }

  // ===========================================================================
  // MAIN REQUEST HANDLER
  // ===========================================================================

  async handleRequest(request: USSDRequest): Promise<USSDResponse> {
    const startTime = Date.now();

    try {
      // Get or create session
      let session = await this.getSession(request.sessionId);

      if (!session) {
        session = await this.createSession(request);
      } else {
        // Update session with new input
        session.lastInput = request.input;
        session.inputHistory.push(request.input);
        session.updatedAt = new Date();
      }

      // Process input based on current state
      const response = await this.processInput(session, request.input);

      // Save session
      await this.updateSession(session);

      // Log request
      this.eventEmitter.emit("ussd:request", {
        sessionId: request.sessionId,
        phoneNumber: request.phoneNumber,
        input: request.input,
        state: session.state,
        response: response.message,
        duration: Date.now() - startTime,
      });

      return response;
    } catch (error) {
      this.eventEmitter.emit("ussd:error", {
        sessionId: request.sessionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        message: this.t("error.generic", "en"),
        continueSession: false,
      };
    }
  }

  // ===========================================================================
  // INPUT PROCESSING
  // ===========================================================================

  private async processInput(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    // Handle back/cancel commands globally
    if (input === "0" || input.toLowerCase() === "back") {
      return this.goBack(session);
    }
    if (input === "00" || input.toLowerCase() === "cancel") {
      return this.goToMainMenu(session);
    }

    // Process based on current state
    switch (session.state) {
      case USSDState.MAIN_MENU:
        return this.handleMainMenu(session, input);

      case USSDState.BOOK_RIDE_METHOD:
        return this.handleBookingMethod(session, input);

      case USSDState.ENTER_PICKUP:
        return this.handlePickupEntry(session, input);

      case USSDState.ENTER_DESTINATION:
        return this.handleDestinationEntry(session, input);

      case USSDState.SELECT_VEHICLE:
        return this.handleVehicleSelection(session, input);

      case USSDState.CONFIRM_BOOKING:
        return this.handleBookingConfirmation(session, input);

      case USSDState.TRACK_RIDE:
        return this.handleTrackRide(session, input);

      case USSDState.WALLET_MENU:
        return this.handleWalletMenu(session, input);

      case USSDState.WALLET_TOPUP:
        return this.handleWalletTopup(session, input);

      case USSDState.WALLET_SEND:
        return this.handleWalletSend(session, input);

      case USSDState.RECENT_TRIPS:
        return this.handleRecentTrips(session, input);

      case USSDState.SAVED_PLACES:
        return this.handleSavedPlaces(session, input);

      case USSDState.LANGUAGE_SELECT:
        return this.handleLanguageSelect(session, input);

      case USSDState.ENTER_PIN:
        return this.handlePinEntry(session, input);

      case USSDState.HELP:
        return this.handleHelp(session, input);

      default:
        return this.showMainMenu(session);
    }
  }

  // ===========================================================================
  // MENU HANDLERS
  // ===========================================================================

  private async handleMainMenu(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;

    switch (input) {
      case "1": // Book a Ride
        session.state = USSDState.BOOK_RIDE_METHOD;
        session.menuPath.push("BOOK_RIDE");
        return {
          message: this.formatMenu([
            this.t("menu.book_ride", lang),
            "1. " + this.t("option.current_location", lang),
            "2. " + this.t("option.enter_pickup", lang),
            "3. " + this.t("option.saved_places", lang),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };

      case "2": // Track My Ride
        return this.showActiveTrip(session);

      case "3": // My Wallet
        session.state = USSDState.WALLET_MENU;
        session.menuPath.push("WALLET");
        const balance = await this.getWalletBalance(session.userId);
        return {
          message: this.formatMenu([
            this.t("menu.wallet", lang),
            this.t("wallet.balance", lang, {
              amount: this.formatCurrency(balance, lang),
            }),
            "",
            "1. " + this.t("option.add_money", lang),
            "2. " + this.t("option.send_money", lang),
            "3. " + this.t("option.history", lang),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };

      case "4": // Recent Trips
        return this.showRecentTrips(session);

      case "5": // Help
        session.state = USSDState.HELP;
        session.menuPath.push("HELP");
        return {
          message: this.formatMenu([
            this.t("menu.help", lang),
            this.t("help.call", lang),
            this.t("help.sms", lang),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };

      case "6": // Language
        session.state = USSDState.LANGUAGE_SELECT;
        session.menuPath.push("LANGUAGE");
        return {
          message: this.formatMenu([
            this.t("menu.language", lang),
            "1. English",
            "2. Kiswahili",
            "3. Yorùbá",
            "4. Hausa",
            "5. Français",
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };

      default:
        return this.showMainMenu(session);
    }
  }

  private async handleBookingMethod(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;
    session.bookingData = session.bookingData || {};

    switch (input) {
      case "1": // Current Location
        // Use last known GPS location or cell tower location
        const location = await this.getCurrentLocation(session.phoneNumber);
        if (location) {
          session.bookingData.pickup = location.coords;
          session.bookingData.pickupAddress = location.address;
          session.state = USSDState.ENTER_DESTINATION;

          return {
            message: this.formatMenu([
              this.t("booking.pickup_set", lang),
              location.address,
              "",
              this.t("prompt.enter_destination", lang),
              "",
              "0. " + this.t("option.back", lang),
            ]),
            continueSession: true,
          };
        } else {
          session.state = USSDState.ENTER_PICKUP;
          return {
            message: this.formatMenu([
              this.t("error.location_not_found", lang),
              this.t("prompt.enter_pickup", lang),
              "",
              "0. " + this.t("option.back", lang),
            ]),
            continueSession: true,
          };
        }

      case "2": // Enter Pickup
        session.state = USSDState.ENTER_PICKUP;
        return {
          message: this.formatMenu([
            this.t("prompt.enter_pickup", lang),
            this.t("hint.address_example", lang),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };

      case "3": // Saved Places
        return this.showSavedPlaces(session, "pickup");

      default:
        return this.showMainMenu(session);
    }
  }

  private async handlePickupEntry(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;

    // Geocode the input address
    const location = await this.geocodeAddress(input);

    if (!location) {
      return {
        message: this.formatMenu([
          this.t("error.address_not_found", lang),
          this.t("prompt.try_again", lang),
          "",
          "0. " + this.t("option.back", lang),
        ]),
        continueSession: true,
      };
    }

    session.bookingData = session.bookingData || {};
    session.bookingData.pickup = location.coords;
    session.bookingData.pickupAddress = location.address;
    session.state = USSDState.ENTER_DESTINATION;

    return {
      message: this.formatMenu([
        this.t("booking.pickup_set", lang),
        this.truncateAddress(location.address, 40),
        "",
        this.t("prompt.enter_destination", lang),
        "",
        "0. " + this.t("option.back", lang),
      ]),
      continueSession: true,
    };
  }

  private async handleDestinationEntry(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;

    // Check for saved place shortcuts
    if (input === "1" || input.toLowerCase() === "home") {
      const home = await this.getSavedPlace(session.userId, "home");
      if (home) {
        return this.setDestinationAndShowEstimate(
          session,
          home.coords,
          home.address
        );
      }
    }
    if (input === "2" || input.toLowerCase() === "work") {
      const work = await this.getSavedPlace(session.userId, "work");
      if (work) {
        return this.setDestinationAndShowEstimate(
          session,
          work.coords,
          work.address
        );
      }
    }

    // Geocode the input
    const location = await this.geocodeAddress(input);

    if (!location) {
      return {
        message: this.formatMenu([
          this.t("error.address_not_found", lang),
          this.t("prompt.try_again", lang),
          "",
          this.t("hint.shortcuts", lang),
          "1. Home",
          "2. Work",
          "",
          "0. " + this.t("option.back", lang),
        ]),
        continueSession: true,
      };
    }

    return this.setDestinationAndShowEstimate(
      session,
      location.coords,
      location.address
    );
  }

  private async setDestinationAndShowEstimate(
    session: USSDSession,
    coords: GeoLocation,
    address: string
  ): Promise<USSDResponse> {
    const lang = session.language;
    session.bookingData = session.bookingData || {};
    session.bookingData.dropoff = coords;
    session.bookingData.dropoffAddress = address;

    // Get fare estimate
    const estimate = await this.getFareEstimate(
      session.bookingData.pickup!,
      session.bookingData.dropoff
    );

    session.bookingData.fareEstimate = estimate.fare;
    session.bookingData.eta = estimate.eta;
    session.state = USSDState.CONFIRM_BOOKING;

    return {
      message: this.formatMenu([
        this.t("booking.confirm_title", lang),
        "",
        this.t("booking.pickup_label", lang) + ":",
        this.truncateAddress(session.bookingData.pickupAddress!, 35),
        "",
        this.t("booking.dropoff_label", lang) + ":",
        this.truncateAddress(address, 35),
        "",
        this.t("booking.fare_label", lang) +
          ": " +
          this.formatCurrency(estimate.fare, lang),
        this.t("booking.eta_label", lang) +
          ": " +
          estimate.eta +
          " " +
          this.t("unit.minutes", lang),
        "",
        "1. " + this.t("option.confirm", lang),
        "2. " + this.t("option.cancel", lang),
      ]),
      continueSession: true,
    };
  }

  private async handleBookingConfirmation(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;

    if (input === "1") {
      try {
        // Create the booking
        const trip = await this.createTrip(session);

        session.bookingData!.tripId = trip.id;

        // Send SMS confirmation
        await this.sendSMSConfirmation(session.phoneNumber, trip, lang);

        // End session with success
        return {
          message: this.formatMenu([
            this.t("booking.success", lang),
            "",
            this.t("booking.driver", lang) + ": " + trip.driverName,
            this.t("booking.vehicle", lang) + ": " + trip.vehiclePlate,
            this.t("booking.eta", lang) +
              ": " +
              trip.eta +
              " " +
              this.t("unit.minutes", lang),
            "",
            this.t("booking.sms_sent", lang),
          ]),
          continueSession: false,
        };
      } catch (error) {
        return {
          message: this.formatMenu([
            this.t("error.no_drivers", lang),
            "",
            "1. " + this.t("option.try_again", lang),
            "0. " + this.t("option.main_menu", lang),
          ]),
          continueSession: true,
        };
      }
    } else {
      // Cancel and go back
      session.state = USSDState.MAIN_MENU;
      session.bookingData = undefined;
      return this.showMainMenu(session);
    }
  }

  // ===========================================================================
  // WALLET HANDLERS
  // ===========================================================================

  private async handleWalletMenu(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;

    switch (input) {
      case "1": // Add Money
        session.state = USSDState.WALLET_TOPUP;
        return {
          message: this.formatMenu([
            this.t("wallet.topup_title", lang),
            this.t("prompt.enter_amount", lang),
            this.t("hint.min_amount", lang, {
              amount: this.formatCurrency(100, lang),
            }),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };

      case "2": // Send Money
        session.state = USSDState.WALLET_SEND;
        session.walletData = { transactionType: "send" };
        return {
          message: this.formatMenu([
            this.t("wallet.send_title", lang),
            this.t("prompt.enter_phone", lang),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };

      case "3": // History
        return this.showWalletHistory(session);

      default:
        return this.goBack(session);
    }
  }

  private async handleWalletTopup(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;
    const amount = parseInt(input, 10);

    if (isNaN(amount) || amount < 100) {
      return {
        message: this.formatMenu([
          this.t("error.invalid_amount", lang),
          this.t("hint.min_amount", lang, {
            amount: this.formatCurrency(100, lang),
          }),
          "",
          "0. " + this.t("option.back", lang),
        ]),
        continueSession: true,
      };
    }

    // Initiate STK Push / Mobile Money request
    await this.initiateTopUp(session.userId!, session.phoneNumber, amount);

    return {
      message: this.formatMenu([
        this.t("wallet.topup_initiated", lang),
        this.t("wallet.check_phone", lang, {
          amount: this.formatCurrency(amount, lang),
        }),
      ]),
      continueSession: false,
    };
  }

  private async handleWalletSend(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;
    session.walletData = session.walletData || {};

    // First input: recipient phone
    if (!session.walletData.recipientPhone) {
      const phone = this.normalizePhoneNumber(input);
      if (!this.isValidPhoneNumber(phone)) {
        return {
          message: this.formatMenu([
            this.t("error.invalid_phone", lang),
            this.t("prompt.enter_phone", lang),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };
      }

      session.walletData.recipientPhone = phone;
      return {
        message: this.formatMenu([
          this.t("wallet.send_to", lang, { phone }),
          this.t("prompt.enter_amount", lang),
          "",
          "0. " + this.t("option.back", lang),
        ]),
        continueSession: true,
      };
    }

    // Second input: amount
    if (!session.walletData.amount) {
      const amount = parseInt(input, 10);
      if (isNaN(amount) || amount < 50) {
        return {
          message: this.formatMenu([
            this.t("error.invalid_amount", lang),
            this.t("hint.min_send", lang, {
              amount: this.formatCurrency(50, lang),
            }),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };
      }

      const balance = await this.getWalletBalance(session.userId);
      if (amount > balance) {
        return {
          message: this.formatMenu([
            this.t("error.insufficient_balance", lang),
            this.t("wallet.your_balance", lang, {
              amount: this.formatCurrency(balance, lang),
            }),
            "",
            "0. " + this.t("option.back", lang),
          ]),
          continueSession: true,
        };
      }

      session.walletData.amount = amount;
      session.state = USSDState.ENTER_PIN;
      return {
        message: this.formatMenu([
          this.t("wallet.confirm_send", lang),
          this.t("wallet.send_details", lang, {
            amount: this.formatCurrency(amount, lang),
            phone: session.walletData.recipientPhone,
          }),
          "",
          this.t("prompt.enter_pin", lang),
          "",
          "0. " + this.t("option.cancel", lang),
        ]),
        continueSession: true,
      };
    }

    return this.goBack(session);
  }

  private async handlePinEntry(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const lang = session.language;

    // Verify PIN
    const isValid = await this.verifyPin(session.userId!, input);
    if (!isValid) {
      return {
        message: this.formatMenu([
          this.t("error.invalid_pin", lang),
          "",
          this.t("prompt.enter_pin", lang),
          "",
          "0. " + this.t("option.cancel", lang),
        ]),
        continueSession: true,
      };
    }

    // Process the pending transaction
    if (session.walletData?.transactionType === "send") {
      await this.processWalletTransfer(
        session.userId!,
        session.walletData.recipientPhone!,
        session.walletData.amount!
      );

      return {
        message: this.formatMenu([
          this.t("wallet.send_success", lang),
          this.t("wallet.sent_details", lang, {
            amount: this.formatCurrency(session.walletData.amount!, lang),
            phone: session.walletData.recipientPhone,
          }),
        ]),
        continueSession: false,
      };
    }

    return this.showMainMenu(session);
  }

  // ===========================================================================
  // TRACKING & HISTORY
  // ===========================================================================

  private async showActiveTrip(session: USSDSession): Promise<USSDResponse> {
    const lang = session.language;
    const trip = await this.getActiveTrip(session.userId);

    if (!trip) {
      return {
        message: this.formatMenu([
          this.t("tracking.no_active", lang),
          "",
          "1. " + this.t("option.book_ride", lang),
          "0. " + this.t("option.back", lang),
        ]),
        continueSession: true,
      };
    }

    session.state = USSDState.TRACK_RIDE;
    session.bookingData = { tripId: trip.id };

    const statusMessages: Record<string, string> = {
      searching: this.t("status.searching", lang),
      matched: this.t("status.matched", lang, { eta: trip.eta }),
      arriving: this.t("status.arriving", lang),
      in_progress: this.t("status.in_progress", lang, {
        eta: trip.etaToDestination,
      }),
      completed: this.t("status.completed", lang),
    };

    return {
      message: this.formatMenu(
        [
          this.t("tracking.title", lang),
          "",
          statusMessages[trip.status] || trip.status,
          "",
          trip.driverName
            ? this.t("booking.driver", lang) + ": " + trip.driverName
            : "",
          trip.vehiclePlate
            ? this.t("booking.vehicle", lang) + ": " + trip.vehiclePlate
            : "",
          trip.driverPhone
            ? this.t("booking.phone", lang) + ": " + trip.driverPhone
            : "",
          "",
          "1. " + this.t("option.refresh", lang),
          "2. " + this.t("option.call_driver", lang),
          "3. " + this.t("option.cancel_trip", lang),
          "0. " + this.t("option.back", lang),
        ].filter(Boolean)
      ),
      continueSession: true,
    };
  }

  private async handleTrackRide(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    switch (input) {
      case "1": // Refresh
        return this.showActiveTrip(session);

      case "2": // Call Driver
        const trip = await this.getTrip(session.bookingData?.tripId);
        if (trip?.driverPhone) {
          // Send callback request or show number
          return {
            message: this.t("tracking.call_driver", session.language, {
              phone: trip.driverPhone,
            }),
            continueSession: false,
          };
        }
        return this.showActiveTrip(session);

      case "3": // Cancel
        return this.confirmCancelTrip(session);

      default:
        return this.goBack(session);
    }
  }

  private async showRecentTrips(session: USSDSession): Promise<USSDResponse> {
    const lang = session.language;
    const trips = await this.getRecentTrips(session.userId, 5);

    if (trips.length === 0) {
      return {
        message: this.formatMenu([
          this.t("history.empty", lang),
          "",
          "0. " + this.t("option.back", lang),
        ]),
        continueSession: true,
      };
    }

    session.state = USSDState.RECENT_TRIPS;
    const tripLines = trips.map(
      (trip, i) =>
        `${i + 1}. ${this.truncateAddress(trip.destination, 20)} - ${this.formatCurrency(trip.fare, lang)}`
    );

    return {
      message: this.formatMenu([
        this.t("history.title", lang),
        "",
        ...tripLines,
        "",
        "0. " + this.t("option.back", lang),
      ]),
      continueSession: true,
    };
  }

  private async handleRecentTrips(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const index = parseInt(input, 10) - 1;
    const trips = await this.getRecentTrips(session.userId, 5);

    if (index >= 0 && index < trips.length) {
      // Rebook the selected trip
      const trip = trips[index];
      session.bookingData = {
        pickup: trip.pickup,
        pickupAddress: trip.pickupAddress,
        dropoff: trip.dropoff,
        dropoffAddress: trip.dropoffAddress,
      };
      session.state = USSDState.ENTER_DESTINATION;
      return this.setDestinationAndShowEstimate(
        session,
        trip.dropoff,
        trip.dropoffAddress
      );
    }

    return this.goBack(session);
  }

  // ===========================================================================
  // LANGUAGE SELECTION
  // ===========================================================================

  private async handleLanguageSelect(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const languages: Record<string, string> = {
      "1": "en",
      "2": "sw",
      "3": "yo",
      "4": "ha",
      "5": "fr",
    };

    const lang = languages[input];
    if (lang) {
      session.language = lang;
      await this.updateUserLanguage(session.userId, lang);

      return {
        message: this.t("language.changed", lang),
        continueSession: true,
      };
    }

    return this.goBack(session);
  }

  // ===========================================================================
  // SAVED PLACES
  // ===========================================================================

  private async showSavedPlaces(
    session: USSDSession,
    forType: "pickup" | "dropoff"
  ): Promise<USSDResponse> {
    const lang = session.language;
    const places = await this.getSavedPlaces(session.userId);

    session.state = USSDState.SAVED_PLACES;
    session.tempData = { forType };

    if (places.length === 0) {
      return {
        message: this.formatMenu([
          this.t("places.empty", lang),
          "",
          "0. " + this.t("option.back", lang),
        ]),
        continueSession: true,
      };
    }

    const placeLines = places.map(
      (place, i) =>
        `${i + 1}. ${place.name} - ${this.truncateAddress(place.address, 20)}`
    );

    return {
      message: this.formatMenu([
        this.t("places.title", lang),
        "",
        ...placeLines,
        "",
        "0. " + this.t("option.back", lang),
      ]),
      continueSession: true,
    };
  }

  private async handleSavedPlaces(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    const index = parseInt(input, 10) - 1;
    const places = await this.getSavedPlaces(session.userId);
    const forType = session.tempData?.forType as "pickup" | "dropoff";

    if (index >= 0 && index < places.length) {
      const place = places[index];

      if (forType === "pickup") {
        session.bookingData = session.bookingData || {};
        session.bookingData.pickup = place.coords;
        session.bookingData.pickupAddress = place.address;
        session.state = USSDState.ENTER_DESTINATION;

        return {
          message: this.formatMenu([
            this.t("booking.pickup_set", session.language),
            place.address,
            "",
            this.t("prompt.enter_destination", session.language),
            "",
            "0. " + this.t("option.back", session.language),
          ]),
          continueSession: true,
        };
      } else {
        return this.setDestinationAndShowEstimate(
          session,
          place.coords,
          place.address
        );
      }
    }

    return this.goBack(session);
  }

  // ===========================================================================
  // HELP
  // ===========================================================================

  private async handleHelp(
    session: USSDSession,
    input: string
  ): Promise<USSDResponse> {
    return this.goBack(session);
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  async getSession(sessionId: string): Promise<USSDSession | null> {
    const session = this.sessions.get(sessionId);

    if (session && session.expiresAt > new Date()) {
      return session;
    }

    if (session) {
      this.sessions.delete(sessionId);
    }

    return null;
  }

  async createSession(request: USSDRequest): Promise<USSDSession> {
    const user = await this.getUserByPhone(request.phoneNumber);

    const session: USSDSession = {
      id: this.generateId(),
      sessionId: request.sessionId,
      phoneNumber: request.phoneNumber,
      userId: user?.id,
      serviceCode: request.serviceCode,
      carrier: request.carrier || "unknown",
      state: USSDState.MAIN_MENU,
      menuPath: [],
      language: user?.preferredLanguage || "en",
      inputHistory: [],
      expiresAt: new Date(Date.now() + USSD_SESSION_TIMEOUT_MS),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(request.sessionId, session);
    return session;
  }

  async updateSession(session: USSDSession): Promise<void> {
    session.updatedAt = new Date();
    session.expiresAt = new Date(Date.now() + USSD_SESSION_TIMEOUT_MS);
    this.sessions.set(session.sessionId, session);
  }

  async endSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  // ===========================================================================
  // NAVIGATION HELPERS
  // ===========================================================================

  private showMainMenu(session: USSDSession): USSDResponse {
    const lang = session.language;
    session.state = USSDState.MAIN_MENU;
    session.menuPath = [];
    session.bookingData = undefined;
    session.walletData = undefined;
    session.tempData = undefined;

    return {
      message: this.formatMenu([
        this.t("menu.welcome", lang),
        "",
        "1. " + this.t("option.book_ride", lang),
        "2. " + this.t("option.track_ride", lang),
        "3. " + this.t("option.wallet", lang),
        "4. " + this.t("option.recent_trips", lang),
        "5. " + this.t("option.help", lang),
        "6. " + this.t("option.language", lang),
      ]),
      continueSession: true,
    };
  }

  private goBack(session: USSDSession): USSDResponse {
    session.menuPath.pop();

    // Navigate to parent state
    const parentStates: Record<string, USSDState> = {
      [USSDState.BOOK_RIDE_METHOD]: USSDState.MAIN_MENU,
      [USSDState.ENTER_PICKUP]: USSDState.BOOK_RIDE_METHOD,
      [USSDState.ENTER_DESTINATION]: USSDState.BOOK_RIDE_METHOD,
      [USSDState.SELECT_VEHICLE]: USSDState.ENTER_DESTINATION,
      [USSDState.CONFIRM_BOOKING]: USSDState.ENTER_DESTINATION,
      [USSDState.WALLET_MENU]: USSDState.MAIN_MENU,
      [USSDState.WALLET_TOPUP]: USSDState.WALLET_MENU,
      [USSDState.WALLET_SEND]: USSDState.WALLET_MENU,
      [USSDState.RECENT_TRIPS]: USSDState.MAIN_MENU,
      [USSDState.SAVED_PLACES]: USSDState.BOOK_RIDE_METHOD,
      [USSDState.LANGUAGE_SELECT]: USSDState.MAIN_MENU,
      [USSDState.HELP]: USSDState.MAIN_MENU,
      [USSDState.TRACK_RIDE]: USSDState.MAIN_MENU,
    };

    const parentState = parentStates[session.state] || USSDState.MAIN_MENU;
    session.state = parentState;

    // Re-render the parent menu
    return this.processInput(session, "");
  }

  private goToMainMenu(session: USSDSession): USSDResponse {
    return this.showMainMenu(session);
  }

  private async confirmCancelTrip(session: USSDSession): Promise<USSDResponse> {
    const lang = session.language;

    return {
      message: this.formatMenu([
        this.t("cancel.confirm", lang),
        "",
        "1. " + this.t("option.yes_cancel", lang),
        "2. " + this.t("option.no_back", lang),
      ]),
      continueSession: true,
    };
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================

  private formatMenu(lines: string[]): string {
    const message = lines.filter(Boolean).join("\n");
    return message.length > MAX_MESSAGE_LENGTH
      ? message.substring(0, MAX_MESSAGE_LENGTH - 3) + "..."
      : message;
  }

  private truncateAddress(address: string, maxLength: number): string {
    if (address.length <= maxLength) return address;
    return address.substring(0, maxLength - 3) + "...";
  }

  private formatCurrency(amount: number, lang: string): string {
    const currencies: Record<
      string,
      { symbol: string; position: "before" | "after" }
    > = {
      en: { symbol: "KES ", position: "before" },
      sw: { symbol: "KES ", position: "before" },
      yo: { symbol: "₦", position: "before" },
      ha: { symbol: "₦", position: "before" },
      fr: { symbol: " XOF", position: "after" },
    };

    const config = currencies[lang] || currencies.en;
    const formatted = Math.round(amount).toLocaleString();

    return config.position === "before"
      ? config.symbol + formatted
      : formatted + config.symbol;
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, "");

    // Handle different formats
    if (digits.startsWith("0")) {
      return "+254" + digits.substring(1); // Kenya
    }
    if (digits.startsWith("254")) {
      return "+" + digits;
    }
    if (digits.length === 9) {
      return "+254" + digits;
    }

    return "+" + digits;
  }

  private isValidPhoneNumber(phone: string): boolean {
    return /^\+\d{10,15}$/.test(phone);
  }

  private generateId(): string {
    return `ussd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===========================================================================
  // TRANSLATION (SIMPLIFIED)
  // ===========================================================================

  private t(
    key: string,
    lang: string,
    params?: Record<string, unknown>
  ): string {
    const translations = this.getTranslations(lang);
    let text = translations[key] || key;

    if (params) {
      for (const [param, value] of Object.entries(params)) {
        text = text.replace(`{${param}}`, String(value));
      }
    }

    return text;
  }

  private getTranslations(lang: string): Record<string, string> {
    const translations: Record<string, Record<string, string>> = {
      en: {
        "menu.welcome": "Welcome to UBI",
        "menu.book_ride": "Book a Ride",
        "menu.wallet": "My Wallet",
        "menu.help": "Help",
        "menu.language": "Language",
        "option.book_ride": "Book Ride",
        "option.track_ride": "Track Ride",
        "option.wallet": "My Wallet",
        "option.recent_trips": "Recent Trips",
        "option.help": "Help",
        "option.language": "Language",
        "option.current_location": "Current Location",
        "option.enter_pickup": "Enter Pickup",
        "option.saved_places": "Saved Places",
        "option.back": "Back",
        "option.confirm": "Confirm",
        "option.cancel": "Cancel",
        "option.add_money": "Add Money",
        "option.send_money": "Send Money",
        "option.history": "History",
        "option.refresh": "Refresh",
        "option.call_driver": "Call Driver",
        "option.cancel_trip": "Cancel Trip",
        "option.yes_cancel": "Yes, Cancel",
        "option.no_back": "No, Go Back",
        "option.main_menu": "Main Menu",
        "option.try_again": "Try Again",
        "prompt.enter_destination": "Enter destination:",
        "prompt.enter_pickup": "Enter pickup address:",
        "prompt.enter_amount": "Enter amount:",
        "prompt.enter_phone": "Enter phone number:",
        "prompt.enter_pin": "Enter PIN:",
        "hint.address_example": "e.g. Westlands, Nairobi",
        "hint.min_amount": "Minimum: {amount}",
        "hint.min_send": "Minimum: {amount}",
        "hint.shortcuts": "Quick options:",
        "booking.pickup_set": "Pickup set to:",
        "booking.confirm_title": "Confirm Your Ride",
        "booking.pickup_label": "From",
        "booking.dropoff_label": "To",
        "booking.fare_label": "Est. Fare",
        "booking.eta_label": "ETA",
        "booking.driver": "Driver",
        "booking.vehicle": "Vehicle",
        "booking.phone": "Phone",
        "booking.eta": "ETA",
        "booking.success": "Ride booked!",
        "booking.sms_sent": "Details sent via SMS",
        "wallet.balance": "Balance: {amount}",
        "wallet.topup_title": "Add Money",
        "wallet.send_title": "Send Money",
        "wallet.send_to": "Sending to {phone}",
        "wallet.your_balance": "Your balance: {amount}",
        "wallet.confirm_send": "Confirm Transfer",
        "wallet.send_details": "{amount} to {phone}",
        "wallet.topup_initiated": "Check your phone",
        "wallet.check_phone": "Approve {amount} payment on your phone",
        "wallet.send_success": "Money sent!",
        "wallet.sent_details": "{amount} sent to {phone}",
        "tracking.title": "Track Your Ride",
        "tracking.no_active": "No active ride",
        "tracking.call_driver": "Call {phone}",
        "status.searching": "Finding you a driver...",
        "status.matched": "Driver assigned! ETA: {eta} mins",
        "status.arriving": "Driver arriving now!",
        "status.in_progress": "Trip in progress. ETA: {eta} mins",
        "status.completed": "Trip completed",
        "history.title": "Recent Trips",
        "history.empty": "No recent trips",
        "places.title": "Saved Places",
        "places.empty": "No saved places",
        "cancel.confirm": "Cancel this ride?",
        "language.changed": "Language updated!",
        "help.call": "Call: 0800-UBI-HELP",
        "help.sms": "SMS: HELP to 20384",
        "error.generic": "Something went wrong. Please try again.",
        "error.location_not_found": "Could not detect location",
        "error.address_not_found": "Address not found",
        "error.no_drivers": "No drivers available",
        "error.invalid_amount": "Invalid amount",
        "error.invalid_phone": "Invalid phone number",
        "error.invalid_pin": "Invalid PIN",
        "error.insufficient_balance": "Insufficient balance",
        "unit.minutes": "mins",
      },
      sw: {
        "menu.welcome": "Karibu UBI",
        "menu.book_ride": "Weka Safari",
        "option.book_ride": "Weka Safari",
        "option.track_ride": "Fuatilia Safari",
        "option.wallet": "Mkoba Wangu",
        "option.recent_trips": "Safari za Karibuni",
        "option.help": "Msaada",
        "option.language": "Lugha",
        "option.back": "Rudi",
        "option.confirm": "Thibitisha",
        "option.cancel": "Ghairi",
        "prompt.enter_destination": "Ingiza mwisho:",
        "booking.success": "Safari imewekwa!",
        "error.generic": "Kuna hitilafu. Jaribu tena.",
        "unit.minutes": "dakika",
      },
      yo: {
        "menu.welcome": "Ẹ kú àbọ̀ sí UBI",
        "option.book_ride": "Bùkù Irin-àjò",
        "option.back": "Padà",
        "booking.success": "Irin-ajo ti fi silẹ!",
        "unit.minutes": "ìṣẹ́jú",
      },
    };

    return { ...translations.en, ...translations[lang] };
  }

  // ===========================================================================
  // MENU INITIALIZATION
  // ===========================================================================

  private initializeMenus(): void {
    // Menus are defined inline for simplicity
    // In production, load from database
  }

  // ===========================================================================
  // EXTERNAL SERVICE STUBS
  // ===========================================================================

  private async getUserByPhone(
    phone: string
  ): Promise<{ id: string; preferredLanguage: string } | null> {
    // Query user service
    return { id: "user_123", preferredLanguage: "en" };
  }

  private async getCurrentLocation(
    phone: string
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    // Get from cell tower location or last GPS
    return null;
  }

  private async geocodeAddress(
    address: string
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    // Call geocoding service
    return {
      coords: { lat: -1.2921, lng: 36.8219 },
      address: address,
    };
  }

  private async getFareEstimate(
    pickup: GeoLocation,
    dropoff: GeoLocation
  ): Promise<{ fare: number; eta: number }> {
    return { fare: 350, eta: 5 };
  }

  private async createTrip(session: USSDSession): Promise<any> {
    return {
      id: "trip_" + Date.now(),
      driverName: "John K.",
      vehiclePlate: "KDA 123X",
      driverPhone: "+254700123456",
      eta: 5,
    };
  }

  private async sendSMSConfirmation(
    phone: string,
    trip: any,
    lang: string
  ): Promise<void> {
    // Send via SMS service
  }

  private async getWalletBalance(userId?: string): Promise<number> {
    return 1500;
  }

  private async initiateTopUp(
    userId: string,
    phone: string,
    amount: number
  ): Promise<void> {
    // Initiate M-Pesa STK push
  }

  private async verifyPin(userId: string, pin: string): Promise<boolean> {
    return pin === "1234";
  }

  private async processWalletTransfer(
    userId: string,
    recipientPhone: string,
    amount: number
  ): Promise<void> {
    // Process P2P transfer
  }

  private async getActiveTrip(userId?: string): Promise<any> {
    return null;
  }

  private async getTrip(tripId?: string): Promise<any> {
    return null;
  }

  private async getRecentTrips(
    userId?: string,
    limit?: number
  ): Promise<any[]> {
    return [];
  }

  private async getSavedPlaces(userId?: string): Promise<any[]> {
    return [];
  }

  private async getSavedPlace(userId?: string, type?: string): Promise<any> {
    return null;
  }

  private async updateUserLanguage(
    userId?: string,
    lang?: string
  ): Promise<void> {
    // Update user preferences
  }

  private async showWalletHistory(session: USSDSession): Promise<USSDResponse> {
    return {
      message: "Transaction history coming soon\n\n0. Back",
      continueSession: true,
    };
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default USSDService;
