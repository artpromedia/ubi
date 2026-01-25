// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - USSD GATEWAY SERVICE
// =============================================================================
// Full USSD booking flow supporting feature phones on 2G networks
// Target: 50M+ users via USSD, <3 second response times
// =============================================================================

import { logger } from "@/lib/logger";
import {
  GeoLocation,
  IUSSDService,
  USSDRequest,
  USSDResponse,
  USSDSession,
  USSDState,
} from "@/types/offline.types";
import { prisma } from "@ubi/database";
import { Redis } from "ioredis";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

// Redis client for session management and caching
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Phone number normalization
function normalizePhone(phone: string): string {
  const cleaned = phone.replaceAll(/[^\d+]/g, "");
  const patterns: Record<string, { pattern: RegExp; code: string }> = {
    KE: { pattern: /^(?:\+?254|0)?([17]\d{8})$/, code: "254" },
    NG: { pattern: /^(?:\+?234|0)?([789][01]\d{8})$/, code: "234" },
    GH: { pattern: /^(?:\+?233|0)?([235]\d{8})$/, code: "233" },
    ZA: { pattern: /^(?:\+?27|0)?([6-8]\d{8})$/, code: "27" },
  };

  for (const { pattern, code } of Object.values(patterns)) {
    const match = pattern.exec(cleaned);
    if (match) return `+${code}${match[1]}`;
  }
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

// =============================================================================
// USSD CONSTANTS
// =============================================================================

const USSD_SESSION_TIMEOUT_MS = 180000; // 3 minutes
const MAX_MESSAGE_LENGTH = 182; // USSD max characters
// const _MAX_GSM7_LENGTH = 160;

// =============================================================================
// USSD SERVICE
// =============================================================================

export class USSDService implements IUSSDService {
  private readonly eventEmitter: EventEmitter;

  // Session storage (Redis in production)
  private readonly sessions: Map<string, USSDSession> = new Map();

  // Menu definitions
  // private _menus: Map<string, USSDMenu> = new Map();

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

      if (session) {
        // Update session with new input
        session.lastInput = request.input;
        session.inputHistory.push(request.input);
        session.updatedAt = new Date();
      } else {
        session = await this.createSession(request);
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
    input: string,
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
        return this.handleBookingConfirmation(session, input);

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
    input: string,
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

      case "3": {
        // My Wallet
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
      }

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
    input: string,
  ): Promise<USSDResponse> {
    const lang = session.language;
    session.bookingData = session.bookingData || {};

    switch (input) {
      case "1": {
        // Current Location
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
    input: string,
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
    input: string,
  ): Promise<USSDResponse> {
    const lang = session.language;

    // Check for saved place shortcuts
    if (input === "1" || input.toLowerCase() === "home") {
      const home = await this.getSavedPlace(session.userId, "home");
      if (home) {
        return this.setDestinationAndShowEstimate(
          session,
          home.coords,
          home.address,
        );
      }
    }
    if (input === "2" || input.toLowerCase() === "work") {
      const work = await this.getSavedPlace(session.userId, "work");
      if (work) {
        return this.setDestinationAndShowEstimate(
          session,
          work.coords,
          work.address,
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
      location.address,
    );
  }

  private async setDestinationAndShowEstimate(
    session: USSDSession,
    coords: GeoLocation,
    address: string,
  ): Promise<USSDResponse> {
    const lang = session.language;
    session.bookingData = session.bookingData || {};
    session.bookingData.dropoff = coords;
    session.bookingData.dropoffAddress = address;

    // Get fare estimate
    const estimate = await this.getFareEstimate(
      session.bookingData.pickup!,
      session.bookingData.dropoff,
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
    input: string,
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
        console.error("Booking confirmation failed:", error);
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
    input: string,
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
    input: string,
  ): Promise<USSDResponse> {
    const lang = session.language;
    const amount = Number.parseInt(input, 10);

    if (Number.isNaN(amount) || amount < 100) {
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
    input: string,
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
      const amount = Number.parseInt(input, 10);
      if (Number.isNaN(amount) || amount < 50) {
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
    input: string,
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
        session.walletData.amount!,
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
        ].filter(Boolean),
      ),
      continueSession: true,
    };
  }

  private async handleTrackRide(
    session: USSDSession,
    input: string,
  ): Promise<USSDResponse> {
    switch (input) {
      case "1": // Refresh
        return this.showActiveTrip(session);

      case "2": {
        // Call Driver
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
      }

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
        `${i + 1}. ${this.truncateAddress(trip.destination, 20)} - ${this.formatCurrency(trip.fare, lang)}`,
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
    input: string,
  ): Promise<USSDResponse> {
    const index = Number.parseInt(input, 10) - 1;
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
        trip.dropoffAddress,
      );
    }

    return this.goBack(session);
  }

  // ===========================================================================
  // LANGUAGE SELECTION
  // ===========================================================================

  private async handleLanguageSelect(
    session: USSDSession,
    input: string,
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
    forType: "pickup" | "dropoff",
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
        `${i + 1}. ${place.name} - ${this.truncateAddress(place.address, 20)}`,
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
    input: string,
  ): Promise<USSDResponse> {
    const index = Number.parseInt(input, 10) - 1;
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
          place.address,
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
    _input: string,
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

  private async goBack(session: USSDSession): Promise<USSDResponse> {
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
    return await this.processInput(session, "");
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
    if (!config) {
      return "KES " + Math.round(amount).toLocaleString();
    }
    const formatted = Math.round(amount).toLocaleString();

    return config.position === "before"
      ? config.symbol + formatted
      : formatted + config.symbol;
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digits
    const digits = phone.replaceAll(/\D/g, "");

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
    return `ussd_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 2 + 9)}`;
  }

  // ===========================================================================
  // TRANSLATION (SIMPLIFIED)
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
  // EXTERNAL SERVICE IMPLEMENTATIONS
  // ===========================================================================

  private async getUserByPhone(phone: string): Promise<{
    id: string;
    preferredLanguage: string;
    riderId?: string;
    walletId?: string;
    currency?: string;
  } | null> {
    try {
      const normalizedPhone = normalizePhone(phone);
      const user = await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        include: {
          rider: true,
          walletAccounts: {
            where: { accountType: "USER_WALLET" },
          },
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        preferredLanguage: user.language,
        riderId: user.rider?.id,
        walletId: user.walletAccounts?.[0]?.id,
        currency: user.currency,
      };
    } catch (error) {
      logger.error("USSD: Error fetching user by phone", { phone, error });
      return null;
    }
  }

  private async getCurrentLocation(
    phone: string,
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    try {
      const cacheKey = `location:cell:${normalizePhone(phone)}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const user = await this.getUserByPhone(phone);
      if (!user?.riderId) return null;

      const lastRide = await prisma.ride.findFirst({
        where: { riderId: user.riderId },
        orderBy: { requestedAt: "desc" },
      });

      if (
        lastRide &&
        lastRide.requestedAt > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ) {
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
      logger.error("USSD: Error getting current location", { phone, error });
      return null;
    }
  }

  private async geocodeAddress(
    address: string,
  ): Promise<{ coords: GeoLocation; address: string } | null> {
    try {
      const cacheKey = `geocode:${address.toLowerCase().trim()}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const landmarks: Record<
        string,
        { lat: number; lng: number; address: string }
      > = {
        westlands: {
          lat: -1.2673,
          lng: 36.8028,
          address: "Westlands, Nairobi",
        },
        cbd: { lat: -1.2864, lng: 36.8172, address: "CBD, Nairobi" },
        jkia: { lat: -1.3192, lng: 36.9275, address: "JKIA Airport" },
        vi: { lat: 6.4281, lng: 3.4219, address: "Victoria Island, Lagos" },
        ikeja: { lat: 6.6018, lng: 3.3515, address: "Ikeja, Lagos" },
        lekki: { lat: 6.4698, lng: 3.5852, address: "Lekki, Lagos" },
      };

      const normalizedAddress = address.toLowerCase().trim();
      for (const [landmark, location] of Object.entries(landmarks)) {
        if (normalizedAddress.includes(landmark)) {
          const result = {
            coords: { lat: location.lat, lng: location.lng },
            address: location.address,
          };
          await redis.setex(cacheKey, 86400, JSON.stringify(result));
          return result;
        }
      }

      if (process.env.GEOCODE_API_URL) {
        const response = await fetch(
          `${process.env.GEOCODE_API_URL}?address=${encodeURIComponent(address)}&key=${process.env.GEOCODE_API_KEY}`,
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
      return null;
    } catch (error) {
      logger.error("USSD: Error geocoding address", { address, error });
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
      const R = 6371;
      const dLat = ((dropoff.lat - pickup.lat) * Math.PI) / 180;
      const dLng = ((dropoff.lng - pickup.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((pickup.lat * Math.PI) / 180) *
          Math.cos((dropoff.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      const pricing = (await redis.hgetall("pricing:config")) || {};
      const baseFare = Number.parseFloat(pricing.baseFare) || 100;
      const perKm = Number.parseFloat(pricing.perKm) || 50;
      const currency = pricing.currency || "NGN";
      const estimatedMinutes = Math.ceil((distance / 25) * 60);
      const fare = Math.round(
        baseFare + distance * perKm + estimatedMinutes * 5,
      );

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
      logger.error("USSD: Error calculating fare", { pickup, dropoff, error });
      return { fare: 500, eta: 15, distance: 5, currency: "NGN" };
    }
  }

  private async createTrip(session: USSDSession): Promise<any> {
    try {
      const user = await this.getUserByPhone(session.phoneNumber);
      if (!user?.riderId) throw new Error("User not found or not a rider");

      const ride = await prisma.ride.create({
        data: {
          riderId: user.riderId,
          status: "PENDING",
          rideType: "ECONOMY",
          pickupAddress: session.data.pickupAddress || "Current Location",
          pickupLatitude: session.data.pickup?.lat || 0,
          pickupLongitude: session.data.pickup?.lng || 0,
          dropoffAddress: session.data.dropoffAddress || "",
          dropoffLatitude: session.data.dropoff?.lat || 0,
          dropoffLongitude: session.data.dropoff?.lng || 0,
          estimatedFare: session.data.fare || 0,
          currency: (user.currency as any) || "NGN",
          estimatedDistance: session.data.distance || 0,
          estimatedDuration: (session.data.eta || 0) * 60,
          paymentMethod: (session.data.paymentMethod as any) || "WALLET",
        },
      });

      this.eventEmitter.emit("ride:requested", {
        rideId: ride.id,
        source: "ussd",
      });

      const nearestDriver = await prisma.driver.findFirst({
        where: { isOnline: true, isAvailable: true },
        include: { user: true, vehicle: true },
      });

      return {
        id: ride.id,
        driverName: nearestDriver?.user?.firstName || "Finding driver...",
        vehiclePlate: nearestDriver?.vehicle?.plateNumber || "Pending",
        driverPhone: nearestDriver?.user?.phone || "",
        eta: session.data.eta || 5,
      };
    } catch (error) {
      logger.error("USSD: Error creating trip", { session: session.id, error });
      throw error;
    }
  }

  private async sendSMSConfirmation(
    phone: string,
    trip: any,
    lang: string,
  ): Promise<void> {
    try {
      const messages: Record<string, string> = {
        en: `UBI Booking Confirmed!\nTrip: ${trip.id.slice(-6)}\nDriver: ${trip.driverName}\nVehicle: ${trip.vehiclePlate}\nETA: ${trip.eta} min`,
        sw: `UBI Imehifadhiwa!\nSafari: ${trip.id.slice(-6)}\nDereva: ${trip.driverName}\nGari: ${trip.vehiclePlate}\nETA: dakika ${trip.eta}`,
      };
      this.eventEmitter.emit("sms:send", {
        to: phone,
        message: messages[lang] || messages.en,
        priority: "high",
      });
      logger.info("USSD: SMS confirmation sent", { phone, tripId: trip.id });
    } catch (error) {
      logger.error("USSD: Error sending SMS confirmation", { phone, error });
    }
  }

  private async getWalletBalance(userId?: string): Promise<number> {
    try {
      if (!userId) return 0;
      const wallet = await prisma.walletAccount.findFirst({
        where: { userId, accountType: "USER_WALLET" },
      });
      return wallet ? Number(wallet.availableBalance) : 0;
    } catch (error) {
      logger.error("USSD: Error getting wallet balance", { userId, error });
      return 0;
    }
  }

  private async initiateTopUp(
    userId: string,
    phone: string,
    amount: number,
  ): Promise<{ reference: string; status: string }> {
    try {
      const normalizedPhone = normalizePhone(phone);
      const reference = `TOPUP_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      let provider: "MPESA" | "MTN_MOMO_GH" | "AIRTEL_MONEY" = "MPESA";
      if (normalizedPhone.startsWith("+234")) provider = "AIRTEL_MONEY";
      else if (normalizedPhone.startsWith("+233")) provider = "MTN_MOMO_GH";

      const user = await prisma.user.findUnique({ where: { id: userId } });
      await prisma.paymentTransaction.create({
        data: {
          userId,
          provider,
          providerReference: reference,
          amount,
          currency: user?.currency || "NGN",
          status: "PENDING",
        },
      });

      this.eventEmitter.emit("payment:topup:initiated", {
        reference,
        userId,
        phone: normalizedPhone,
        amount,
        provider,
      });
      logger.info("USSD: TopUp initiated", { userId, amount, reference });
      return { reference, status: "pending" };
    } catch (error) {
      logger.error("USSD: Error initiating topup", { userId, amount, error });
      throw error;
    }
  }

  private async verifyPin(userId: string, pin: string): Promise<boolean> {
    try {
      const storedHash = await redis.get(`pin:${userId}`);
      if (!storedHash) {
        const wallet = await prisma.walletAccount.findFirst({
          where: { userId, accountType: "USER_WALLET" },
        });
        if (!wallet?.metadata) return false;
        const metadata = wallet.metadata as any;
        if (!metadata.pinHash) return false;
        const inputHash = crypto
          .createHash("sha256")
          .update(pin + userId)
          .digest("hex");
        return inputHash === metadata.pinHash;
      }
      const inputHash = crypto
        .createHash("sha256")
        .update(pin + userId)
        .digest("hex");
      return inputHash === storedHash;
    } catch (error) {
      logger.error("USSD: Error verifying PIN", { userId, error });
      return false;
    }
  }

  private async processWalletTransfer(
    userId: string,
    recipientPhone: string,
    amount: number,
  ): Promise<{ success: boolean; reference?: string; error?: string }> {
    try {
      const normalizedRecipient = normalizePhone(recipientPhone);
      const sender = await prisma.user.findUnique({
        where: { id: userId },
        include: { walletAccounts: { where: { accountType: "USER_WALLET" } } },
      });
      const recipient = await prisma.user.findUnique({
        where: { phone: normalizedRecipient },
        include: { walletAccounts: { where: { accountType: "USER_WALLET" } } },
      });

      if (!sender?.walletAccounts?.[0] || !recipient?.walletAccounts?.[0]) {
        return { success: false, error: "Invalid accounts" };
      }

      const senderWallet = sender.walletAccounts[0];
      const recipientWallet = recipient.walletAccounts[0];

      if (Number(senderWallet.availableBalance) < amount) {
        return { success: false, error: "Insufficient balance" };
      }

      const idempotencyKey = `transfer_${userId}_${Date.now()}`;

      await prisma.$transaction(async (tx) => {
        await tx.walletAccount.update({
          where: { id: senderWallet.id },
          data: {
            balance: { decrement: amount },
            availableBalance: { decrement: amount },
          },
        });
        await tx.walletAccount.update({
          where: { id: recipientWallet.id },
          data: {
            balance: { increment: amount },
            availableBalance: { increment: amount },
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            idempotencyKey,
            transactionType: "INTERNAL_TRANSFER",
            status: "COMPLETED",
            amount,
            currency: sender.currency,
            description: `Transfer to ${recipient.firstName}`,
            completedAt: new Date(),
          },
        });

        await tx.ledgerEntry.createMany({
          data: [
            {
              transactionId: transaction.id,
              accountId: senderWallet.id,
              entryType: "DEBIT",
              amount,
              balanceAfter: Number(senderWallet.availableBalance) - amount,
              description: `Transfer to ${normalizedRecipient}`,
            },
            {
              transactionId: transaction.id,
              accountId: recipientWallet.id,
              entryType: "CREDIT",
              amount,
              balanceAfter: Number(recipientWallet.availableBalance) + amount,
              description: `Transfer from ${sender.phone}`,
            },
          ],
        });
      });

      logger.info("USSD: Wallet transfer completed", {
        userId,
        recipientPhone: normalizedRecipient,
        amount,
      });
      return { success: true, reference: idempotencyKey };
    } catch (error) {
      logger.error("USSD: Error processing wallet transfer", {
        userId,
        recipientPhone,
        amount,
        error,
      });
      return { success: false, error: "Transfer failed" };
    }
  }

  private async getActiveTrip(userId?: string): Promise<any> {
    try {
      if (!userId) return null;
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
        include: { driver: { include: { user: true, vehicle: true } } },
        orderBy: { requestedAt: "desc" },
      });

      if (!activeRide) return null;

      return {
        id: activeRide.id,
        status: activeRide.status,
        driverName: activeRide.driver?.user?.firstName || "Finding...",
        vehiclePlate: activeRide.driver?.vehicle?.plateNumber || "Pending",
        driverPhone: activeRide.driver?.user?.phone || "",
        pickup: activeRide.pickupAddress,
        dropoff: activeRide.dropoffAddress,
        fare: Number(activeRide.estimatedFare),
      };
    } catch (error) {
      logger.error("USSD: Error getting active trip", { userId, error });
      return null;
    }
  }

  private async getTrip(tripId?: string): Promise<any> {
    try {
      if (!tripId) return null;
      const ride = await prisma.ride.findUnique({
        where: { id: tripId },
        include: { driver: { include: { user: true, vehicle: true } } },
      });
      if (!ride) return null;

      return {
        id: ride.id,
        status: ride.status,
        driverName: ride.driver?.user?.firstName,
        vehiclePlate: ride.driver?.vehicle?.plateNumber,
        driverPhone: ride.driver?.user?.phone,
        pickup: ride.pickupAddress,
        dropoff: ride.dropoffAddress,
        fare: Number(ride.estimatedFare),
      };
    } catch (error) {
      logger.error("USSD: Error getting trip", { tripId, error });
      return null;
    }
  }

  private async getRecentTrips(
    userId?: string,
    limit: number = 5,
  ): Promise<any[]> {
    try {
      if (!userId) return [];
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { rider: true },
      });
      if (!user?.rider) return [];

      const rides = await prisma.ride.findMany({
        where: { riderId: user.rider.id },
        orderBy: { requestedAt: "desc" },
        take: limit,
      });
      return rides.map((ride) => ({
        id: ride.id,
        pickup: ride.pickupAddress,
        dropoff: ride.dropoffAddress,
        fare: Number(ride.estimatedFare),
        date: ride.requestedAt,
        status: ride.status,
      }));
    } catch (error) {
      logger.error("USSD: Error getting recent trips", { userId, error });
      return [];
    }
  }

  private async getSavedPlaces(userId?: string): Promise<any[]> {
    try {
      if (!userId) return [];
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { rider: { include: { savedPlaces: true } } },
      });
      return (
        user?.rider?.savedPlaces?.map((place) => ({
          id: place.id,
          name: place.name,
          type: place.type,
          address: place.address,
          coords: { lat: place.latitude, lng: place.longitude },
        })) || []
      );
    } catch (error) {
      logger.error("USSD: Error getting saved places", { userId, error });
      return [];
    }
  }

  private async getSavedPlace(userId?: string, type?: string): Promise<any> {
    try {
      if (!userId || !type) return null;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          rider: { include: { savedPlaces: { where: { type }, take: 1 } } },
        },
      });
      const place = user?.rider?.savedPlaces?.[0];
      if (!place) return null;
      return {
        id: place.id,
        name: place.name,
        type: place.type,
        address: place.address,
        coords: { lat: place.latitude, lng: place.longitude },
      };
    } catch (error) {
      logger.error("USSD: Error getting saved place", { userId, type, error });
      return null;
    }
  }

  private async updateUserLanguage(
    userId?: string,
    lang?: string,
  ): Promise<void> {
    try {
      if (!userId || !lang) return;
      await prisma.user.update({
        where: { id: userId },
        data: { language: lang },
      });
      await redis.hset(`user:${userId}:prefs`, "language", lang);
      logger.info("USSD: User language updated", { userId, lang });
    } catch (error) {
      logger.error("USSD: Error updating user language", {
        userId,
        lang,
        error,
      });
    }
  }

  private async showWalletHistory(session: USSDSession): Promise<USSDResponse> {
    try {
      const user = await this.getUserByPhone(session.phoneNumber);
      if (!user?.walletId)
        return { message: "No wallet found\n\n0. Back", continueSession: true };

      const entries = await prisma.ledgerEntry.findMany({
        where: { accountId: user.walletId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { transaction: true },
      });

      if (entries.length === 0)
        return {
          message: "No transactions yet\n\n0. Back",
          continueSession: true,
        };

      const lang = session.language || "en";
      const lines = entries.map((e, i) => {
        const symbol = e.entryType === "CREDIT" ? "+" : "-";
        const desc =
          e.description?.slice(0, 15) ||
          e.transaction?.transactionType ||
          "Transaction";
        return `${i + 1}. ${symbol}${Number(e.amount)} - ${desc}`;
      });

      const title = lang === "sw" ? "Historia ya Mkoba" : "Wallet History";
      return {
        message: `${title}:\n${lines.join("\n")}\n\n0. Back`,
        continueSession: true,
      };
    } catch (error) {
      logger.error("USSD: Error showing wallet history", {
        session: session.id,
        error,
      });
      return {
        message: "Error loading history\n\n0. Back",
        continueSession: true,
      };
    }
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default USSDService;
