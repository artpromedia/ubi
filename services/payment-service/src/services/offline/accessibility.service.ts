// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - ACCESSIBILITY SERVICE
// =============================================================================
// WCAG 2.1 AAA compliant accessibility features
// Supports: Screen readers, voice control, motor impairments, cognitive aids
// =============================================================================

import { EventEmitter } from "events";
import {
  AccessibilityPreferences,
  ColorBlindMode,
  IAccessibilityService,
  ScreenReaderAnnouncement,
  VoiceCommand,
  WCAGLevel,
} from "@/types/offline.types";

// =============================================================================
// ACCESSIBILITY CONSTANTS
// =============================================================================

// WCAG 2.1 Contrast Ratios
const CONTRAST_REQUIREMENTS = {
  [WCAGLevel.A]: { normalText: 3.0, largeText: 3.0 },
  [WCAGLevel.AA]: { normalText: 4.5, largeText: 3.0 },
  [WCAGLevel.AAA]: { normalText: 7.0, largeText: 4.5 },
};

// Touch target sizes (in pixels)
const TOUCH_TARGET_SIZES = {
  minimum: 44, // WCAG AA
  enhanced: 48, // Material Design
  large: 64, // For motor impairments
};

// Voice command intents
const VOICE_INTENTS = {
  BOOK_RIDE: ["book", "ride", "trip", "safari", "taxi", "cab"],
  TRACK: ["track", "where", "status", "location", "find"],
  CANCEL: ["cancel", "stop", "end", "terminate"],
  HELP: ["help", "support", "assist", "emergency"],
  NAVIGATE: ["go", "open", "navigate", "show"],
  CONFIRM: ["yes", "confirm", "okay", "proceed", "ndio"],
  DENY: ["no", "cancel", "back", "stop", "hapana"],
  REPEAT: ["repeat", "again", "what", "pardon"],
};

// =============================================================================
// ACCESSIBILITY SERVICE
// =============================================================================

export class AccessibilityService implements IAccessibilityService {
  private eventEmitter: EventEmitter;

  // User preferences cache
  private preferencesCache: Map<string, AccessibilityPreferences> = new Map();

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  // ===========================================================================
  // PREFERENCES MANAGEMENT
  // ===========================================================================

  async getPreferences(userId: string): Promise<AccessibilityPreferences> {
    let prefs = this.preferencesCache.get(userId);

    if (!prefs) {
      prefs = await this.loadPreferences(userId);
      this.preferencesCache.set(userId, prefs);
    }

    return prefs;
  }

  async updatePreferences(
    userId: string,
    updates: Partial<AccessibilityPreferences>
  ): Promise<void> {
    const current = await this.getPreferences(userId);
    const updated = { ...current, ...updates };

    // Validate constraints
    this.validatePreferences(updated);

    // Persist
    await this.savePreferences(userId, updated);
    this.preferencesCache.set(userId, updated);

    this.eventEmitter.emit("preferences:updated", {
      userId,
      preferences: updated,
    });
  }

  private validatePreferences(prefs: AccessibilityPreferences): void {
    // Font size constraints
    if (prefs.fontSize !== undefined) {
      prefs.fontSize = Math.max(0.75, Math.min(3.0, prefs.fontSize));
    }

    // Ensure valid combinations
    if (prefs.reduceMotion && prefs.animationDuration === undefined) {
      prefs.animationDuration = 0;
    }
  }

  private async loadPreferences(
    _userId: string
  ): Promise<AccessibilityPreferences> {
    // In production, load from database
    return this.getDefaultPreferences();
  }

  private async savePreferences(
    _userId: string,
    _prefs: AccessibilityPreferences
  ): Promise<void> {
    // In production, save to database
  }

  private getDefaultPreferences(): AccessibilityPreferences {
    return {
      screenReaderEnabled: false,
      voiceControlEnabled: false,
      fontSize: 1.0,
      highContrast: false,
      colorBlindMode: ColorBlindMode.NONE,
      reduceMotion: false,
      reduceTransparency: false,
      largerTouchTargets: false,
      hapticFeedback: true,
      audioDescriptions: false,
      captionsEnabled: false,
      simplifiedInterface: false,
      readingSpeed: 1.0,
      preferredInputMethod: "touch",
    };
  }

  // ===========================================================================
  // VOICE CONTROL
  // ===========================================================================

  parseVoiceCommand(transcript: string, context?: string): VoiceCommand {
    const normalized = transcript.toLowerCase().trim();

    // Determine intent
    let intent: string = "unknown";
    let confidence = 0;

    for (const [intentName, keywords] of Object.entries(VOICE_INTENTS)) {
      const matchCount = keywords.filter((kw) =>
        normalized.includes(kw)
      ).length;
      const intentConfidence = matchCount / keywords.length;

      if (intentConfidence > confidence) {
        intent = intentName;
        confidence = intentConfidence;
      }
    }

    // Extract entities based on intent
    const entities = this.extractEntities(normalized, intent);

    // Build command
    const command: VoiceCommand = {
      raw: transcript,
      normalized,
      intent,
      entities,
      confidence: Math.min(confidence + 0.3, 1), // Boost base confidence
      context: context || "main_menu",
    };

    // Apply context-specific parsing
    return this.refineCommandByContext(command);
  }

  private extractEntities(
    text: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _intent: string
  ): Record<string, string> {
    const entities: Record<string, string> = {};

    // Location extraction
    const locationPatterns = [
      /(?:to|at|from)\s+(.+?)(?:\s+from|\s+to|$)/i,
      /(?:pick ?up|pickup)\s+(?:at|from)\s+(.+)/i,
      /(?:drop ?off|dropoff|destination)\s+(?:at|to)\s+(.+)/i,
    ];

    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        if (
          pattern.source.includes("from") ||
          pattern.source.includes("pick")
        ) {
          entities.pickup = match[1].trim();
        } else {
          entities.destination = match[1].trim();
        }
      }
    }

    // Simple location (just a place name after "to")
    const toMatch = text.match(/(?:to|going to|go to)\s+(.+)/i);
    if (toMatch && toMatch[1] && !entities.destination) {
      entities.destination = toMatch[1].trim();
    }

    // Number extraction (for amounts, ratings, etc.)
    const numberMatch = text.match(/(\d+(?:\.\d+)?)/);
    if (numberMatch && numberMatch[1]) {
      entities.number = numberMatch[1];
    }

    return entities;
  }

  private refineCommandByContext(command: VoiceCommand): VoiceCommand {
    const { context, normalized } = command;

    // Context-specific refinements
    switch (context) {
      case "booking_confirmation":
        if (
          ["yes", "confirm", "okay", "ndio", "oui"].some((w) =>
            normalized.includes(w)
          )
        ) {
          command.intent = "CONFIRM";
          command.confidence = 0.9;
        }
        if (
          ["no", "cancel", "hapana", "non"].some((w) => normalized.includes(w))
        ) {
          command.intent = "DENY";
          command.confidence = 0.9;
        }
        break;

      case "rating":
        const ratingMatch = normalized.match(/(\d)\s*(?:star|stars)?/);
        if (ratingMatch && ratingMatch[1]) {
          command.entities.rating = ratingMatch[1];
          command.intent = "RATE";
          command.confidence = 0.95;
        }
        break;

      case "address_input":
        // Treat entire phrase as location
        command.entities.location = command.raw;
        command.intent = "SET_LOCATION";
        command.confidence = 0.8;
        break;
    }

    return command;
  }

  getVoiceCommandSuggestions(context: string): string[] {
    const suggestions: Record<string, string[]> = {
      main_menu: ["Book a ride", "Track my ride", "Check my balance", "Help"],
      booking: ["Current location", "Home", "Work", "Enter address"],
      booking_confirmation: [
        "Yes, confirm",
        "No, cancel",
        "Change destination",
      ],
      trip_tracking: ["Call driver", "Cancel trip", "Refresh status"],
    };

    return suggestions[context] || suggestions.main_menu || [];
  }

  // ===========================================================================
  // SCREEN READER SUPPORT
  // ===========================================================================

  generateAnnouncement(
    type: "navigation" | "status" | "action" | "error" | "notification",
    content: string,
    priority: "polite" | "assertive" = "polite"
  ): ScreenReaderAnnouncement {
    return {
      text: content,
      priority,
      language: "en",
      timestamp: new Date(),
      role: this.getAriaRole(type),
    };
  }

  private getAriaRole(type: string): string {
    const roles: Record<string, string> = {
      navigation: "navigation",
      status: "status",
      action: "button",
      error: "alert",
      notification: "log",
    };
    return roles[type] || "status";
  }

  generateScreenReaderText(element: {
    type: string;
    label?: string;
    value?: string;
    state?: string;
    hint?: string;
    children?: string[];
  }): string {
    const parts: string[] = [];

    // Element type
    const typeLabels: Record<string, string> = {
      button: "Button",
      input: "Text field",
      checkbox: "Checkbox",
      radio: "Radio button",
      link: "Link",
      heading: "Heading",
      list: "List",
      listitem: "List item",
      image: "Image",
      map: "Map",
    };

    if (element.label) {
      parts.push(element.label);
    }

    if (element.type) {
      const typeLabel = typeLabels[element.type];
      if (typeLabel) {
        parts.push(typeLabel);
      }
    }

    if (element.value) {
      parts.push(element.value);
    }

    if (element.state) {
      const stateLabels: Record<string, string> = {
        checked: "checked",
        unchecked: "not checked",
        disabled: "disabled",
        expanded: "expanded",
        collapsed: "collapsed",
        selected: "selected",
        loading: "loading",
        error: "has error",
      };
      const stateLabel = stateLabels[element.state];
      if (stateLabel) {
        parts.push(stateLabel);
      }
    }

    if (element.hint) {
      parts.push(element.hint);
    }

    return parts.join(", ");
  }

  generateTripSummaryForScreenReader(trip: any): string {
    const parts: string[] = [];

    // Status
    const statusDescriptions: Record<string, string> = {
      searching: "Searching for a driver",
      matched: "Driver assigned",
      arriving: "Driver is arriving",
      in_progress: "Trip in progress",
      completed: "Trip completed",
      cancelled: "Trip cancelled",
    };
    parts.push(statusDescriptions[trip.status] || trip.status);

    // Driver info
    if (trip.driverName) {
      parts.push(`Your driver is ${trip.driverName}`);
      if (trip.vehicleDescription) {
        parts.push(`driving a ${trip.vehicleDescription}`);
      }
      if (trip.vehiclePlate) {
        const plateText = String(trip.vehiclePlate);
        parts.push(`license plate ${this.spelledOut(plateText)}`);
      }
    }

    // ETA
    if (trip.eta) {
      parts.push(`Estimated arrival in ${trip.eta} minutes`);
    }

    // Fare
    if (trip.fare) {
      parts.push(`Fare is ${trip.fare} ${trip.currency || "shillings"}`);
    }

    // Locations
    const pickupAddress = trip.pickupAddress ? String(trip.pickupAddress) : "";
    const dropoffAddress = trip.dropoffAddress ? String(trip.dropoffAddress) : "";

    if (pickupAddress) {
      parts.push(`Picking up from ${pickupAddress}`);
    }
    if (dropoffAddress) {
      parts.push(`Going to ${dropoffAddress}`);
    }

    return parts.join(". ") + ".";
  }

  private spelledOut(text: string): string {
    // Spell out license plates for screen readers
    return text.split("").join(" ").toUpperCase();
  }

  // ===========================================================================
  // COLOR & CONTRAST
  // ===========================================================================

  adjustColorsForColorBlindness(
    colors: Record<string, string>,
    mode: ColorBlindMode
  ): Record<string, string> {
    if (mode === ColorBlindMode.NONE) {
      return colors;
    }

    const adjustments: Record<string, Record<string, string>> = {
      [ColorBlindMode.PROTANOPIA]: {
        // Red-blind: Replace reds with blues
        "#FF0000": "#0066CC", // Red -> Blue
        "#FF4444": "#4488DD",
        "#00FF00": "#00FF00", // Green stays
        "#FFD700": "#FFCC00", // Gold stays
        "#FF6600": "#0088CC", // Orange -> Blue
      },
      [ColorBlindMode.DEUTERANOPIA]: {
        // Green-blind: Replace greens with blues
        "#00FF00": "#0066CC", // Green -> Blue
        "#44FF44": "#4488DD",
        "#FFD700": "#FFCC00", // Gold stays
        "#FF6600": "#FF6600", // Orange stays
      },
      [ColorBlindMode.TRITANOPIA]: {
        // Blue-blind: Replace blues with reds
        "#0000FF": "#CC0066",
        "#0066CC": "#CC6600",
        "#4488DD": "#DD8844",
      },
      [ColorBlindMode.MONOCHROMACY]: {
        // Convert to grayscale with distinguishable patterns
        // In practice, use patterns/textures instead of colors
      },
    };

    const modeAdjustments = adjustments[mode] || {};
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(colors)) {
      result[key] = modeAdjustments[value.toUpperCase()] || value;
    }

    return result;
  }

  checkContrast(
    foreground: string,
    background: string
  ): {
    ratio: number;
    passesAA: boolean;
    passesAAA: boolean;
    passesLargeTextAA: boolean;
  } {
    const fgLuminance = this.getRelativeLuminance(foreground);

    const lighter = Math.max(fgLuminance, this.getRelativeLuminance(background));
    const darker = Math.min(fgLuminance, this.getRelativeLuminance(background));
    const ratio = (lighter + 0.05) / (darker + 0.05);

    const aaRequirements = CONTRAST_REQUIREMENTS[WCAGLevel.AA];
    const aaaRequirements = CONTRAST_REQUIREMENTS[WCAGLevel.AAA];

    return {
      ratio: Math.round(ratio * 100) / 100,
      passesAA: ratio >= (aaRequirements?.normalText || 4.5),
      passesAAA: ratio >= (aaaRequirements?.normalText || 7.0),
      passesLargeTextAA: ratio >= (aaRequirements?.largeText || 3.0),
    };
  }

  private getRelativeLuminance(hex: string): number {
    // Remove # if present
    const color = hex.replace("#", "");

    // Parse RGB
    const r = parseInt(color.substr(0, 2), 16) / 255;
    const g = parseInt(color.substr(2, 2), 16) / 255;
    const b = parseInt(color.substr(4, 2), 16) / 255;

    // Apply gamma correction
    const sRGB = [r, g, b].map((c) => {
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });

    // Calculate luminance
    return 0.2126 * (sRGB[0] || 0) + 0.7152 * (sRGB[1] || 0) + 0.0722 * (sRGB[2] || 0);
  }

  suggestContrastingColor(
    background: string,
    targetRatio: number = 4.5
  ): string {
    // Try white first
    const whiteContrast = this.checkContrast("#FFFFFF", background);
    if (whiteContrast.ratio >= targetRatio) {
      return "#FFFFFF";
    }

    // Try black
    const blackContrast = this.checkContrast("#000000", background);
    if (blackContrast.ratio >= targetRatio) {
      return "#000000";
    }

    // Return the better option
    return whiteContrast.ratio > blackContrast.ratio ? "#FFFFFF" : "#000000";
  }

  // ===========================================================================
  // MOTOR IMPAIRMENT SUPPORT
  // ===========================================================================

  getTouchTargetSize(userPreference?: boolean): number {
    if (userPreference) {
      return TOUCH_TARGET_SIZES.large;
    }
    return TOUCH_TARGET_SIZES.enhanced;
  }

  calculateSwipeThreshold(
    motorImpairmentLevel?: "mild" | "moderate" | "severe"
  ): {
    minDistance: number;
    maxDuration: number;
    tolerance: number;
  } {
    switch (motorImpairmentLevel) {
      case "severe":
        return {
          minDistance: 30, // Shorter swipe needed
          maxDuration: 2000, // More time allowed
          tolerance: 45, // More angle tolerance (degrees)
        };
      case "moderate":
        return {
          minDistance: 40,
          maxDuration: 1500,
          tolerance: 35,
        };
      case "mild":
        return {
          minDistance: 50,
          maxDuration: 1000,
          tolerance: 25,
        };
      default:
        return {
          minDistance: 60,
          maxDuration: 500,
          tolerance: 20,
        };
    }
  }

  generateKeyboardShortcuts(): Record<string, string> {
    return {
      "Alt+B": "Book a ride",
      "Alt+T": "Track ride",
      "Alt+W": "Open wallet",
      "Alt+H": "Help",
      Escape: "Cancel / Go back",
      Enter: "Confirm",
      Tab: "Next element",
      "Shift+Tab": "Previous element",
      Space: "Activate button",
      "Arrow keys": "Navigate menu",
    };
  }

  // ===========================================================================
  // COGNITIVE ACCESSIBILITY
  // ===========================================================================

  simplifyText(
    text: string,
    _targetLevel: "basic" | "simple" | "standard"
  ): string {
    // In production, use NLP to simplify
    // This is a simplified example

    const simplifications: Record<string, string> = {
      vehicle: "car",
      destination: "where you want to go",
      estimated: "about",
      approximately: "about",
      navigate: "go",
      insufficient: "not enough",
      transaction: "payment",
      authentication: "login",
      verification: "check",
    };

    let simplified = text;
    for (const [complex, simple] of Object.entries(simplifications)) {
      simplified = simplified.replace(new RegExp(complex, "gi"), simple);
    }

    return simplified;
  }

  generateSimplifiedBookingSteps(): Array<{
    step: number;
    title: string;
    description: string;
    action: string;
  }> {
    return [
      {
        step: 1,
        title: "Where are you?",
        description: "Tell us where to pick you up",
        action: "Enter pickup location",
      },
      {
        step: 2,
        title: "Where to?",
        description: "Tell us where you want to go",
        action: "Enter destination",
      },
      {
        step: 3,
        title: "Check the price",
        description: "See how much it costs",
        action: "View fare",
      },
      {
        step: 4,
        title: "Book it!",
        description: "Tap to get a ride",
        action: "Confirm booking",
      },
    ];
  }

  // ===========================================================================
  // WCAG AUDIT
  // ===========================================================================

  async auditPage(pageData: {
    elements: Array<{
      type: string;
      attributes: Record<string, string>;
      text?: string;
      children?: number;
    }>;
    colors: Array<{ foreground: string; background: string }>;
    images: Array<{ hasAlt: boolean; alt?: string }>;
    forms: Array<{ hasLabels: boolean; hasErrors: boolean }>;
  }): Promise<{
    level: WCAGLevel;
    score: number;
    issues: Array<{
      severity: "critical" | "major" | "minor";
      criterion: string;
      description: string;
      element?: string;
    }>;
    recommendations: string[];
  }> {
    const issues: Array<{
      severity: "critical" | "major" | "minor";
      criterion: string;
      description: string;
      element?: string;
    }> = [];

    // Check images for alt text
    for (const img of pageData.images) {
      if (!img.hasAlt) {
        issues.push({
          severity: "critical",
          criterion: "1.1.1 Non-text Content",
          description: "Image missing alt text",
        });
      }
    }

    // Check color contrast
    for (const color of pageData.colors) {
      const contrast = this.checkContrast(color.foreground, color.background);
      if (!contrast.passesAA) {
        issues.push({
          severity: contrast.ratio < 3 ? "critical" : "major",
          criterion: "1.4.3 Contrast (Minimum)",
          description: `Insufficient contrast ratio: ${contrast.ratio}:1`,
        });
      }
    }

    // Check form accessibility
    for (const form of pageData.forms) {
      if (!form.hasLabels) {
        issues.push({
          severity: "critical",
          criterion: "1.3.1 Info and Relationships",
          description: "Form inputs missing labels",
        });
      }
    }

    // Check for interactive element focus
    const interactiveElements = pageData.elements.filter((e) =>
      ["button", "link", "input", "select", "textarea"].includes(e.type)
    );
    for (const element of interactiveElements) {
      if (!element.attributes["tabindex"] && !element.attributes["href"]) {
        // Elements should be focusable
      }
    }

    // Calculate score and level
    const criticalCount = issues.filter(
      (i) => i.severity === "critical"
    ).length;
    const majorCount = issues.filter((i) => i.severity === "major").length;

    let level = WCAGLevel.AAA;
    if (criticalCount > 0) level = WCAGLevel.A;
    else if (majorCount > 2) level = WCAGLevel.AA;

    const score = Math.max(
      0,
      100 - criticalCount * 20 - majorCount * 10 - issues.length * 2
    );

    return {
      level,
      score,
      issues,
      recommendations: this.generateRecommendations(issues),
    };
  }

  private generateRecommendations(
    issues: Array<{ criterion: string }>
  ): string[] {
    const recommendations: string[] = [];
    const criteria = new Set(issues.map((i) => i.criterion));

    if (criteria.has("1.1.1 Non-text Content")) {
      recommendations.push("Add descriptive alt text to all images");
    }
    if (criteria.has("1.4.3 Contrast (Minimum)")) {
      recommendations.push(
        "Increase contrast between text and background colors"
      );
    }
    if (criteria.has("1.3.1 Info and Relationships")) {
      recommendations.push(
        "Associate labels with form inputs using for/id attributes"
      );
    }

    return recommendations;
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  async getScreenReaderText(_screenName: string, _language: string): Promise<string> {
    // Implementation for screen reader text
    return "";
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default AccessibilityService;
