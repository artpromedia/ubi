// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - SERVICE INDEX
// =============================================================================
// Central export for all offline and accessibility services
// =============================================================================

// Services
export { AccessibilityService } from "./accessibility.service";
export { LowBandwidthService } from "./low-bandwidth.service";
export { SMSService } from "./sms.service";
export { TranslationService } from "./translation.service";
export { USSDService } from "./ussd.service";
export { VoiceService } from "./voice.service";

// Re-export types for convenience
export * from "../../types/offline.types";

// =============================================================================
// UNIFIED OFFLINE PLATFORM
// =============================================================================

import { AccessibilityService } from "./accessibility.service";
import { LowBandwidthService } from "./low-bandwidth.service";
import { SMSService } from "./sms.service";
import { TranslationService } from "./translation.service";
import { USSDService } from "./ussd.service";
import { VoiceService } from "./voice.service";

/**
 * UBI Offline & Accessibility Platform
 *
 * "UBI for Everyone" - Ensuring platform accessibility regardless of
 * device capabilities, network connectivity, or user abilities.
 *
 * Features:
 * - USSD booking for feature phones (2G networks)
 * - SMS-based booking and tracking
 * - IVR/Voice booking with call center integration
 * - Low-bandwidth optimization (90% data reduction)
 * - WCAG 2.1 AAA accessibility compliance
 * - Multi-language support (20+ African languages)
 *
 * Target Markets:
 * - Kenya (Safaricom USSD)
 * - Nigeria (MTN, Airtel, Glo USSD)
 * - Ghana (MTN, Vodafone USSD)
 * - South Africa (Vodacom, MTN)
 * - Tanzania (Vodacom, Airtel)
 * - Ethiopia (Ethio Telecom)
 * - DRC (Vodacom, Airtel, Orange)
 *
 * User Segments:
 * - Urban smartphone users (4G/WiFi)
 * - Peri-urban budget phone users (3G/2G)
 * - Rural feature phone users (2G)
 * - Users with visual impairments
 * - Users with motor impairments
 * - Low digital literacy users
 * - Data-constrained users
 */
export class OfflinePlatform {
  public readonly ussd: USSDService;
  public readonly sms: SMSService;
  public readonly voice: VoiceService;
  public readonly lowBandwidth: LowBandwidthService;
  public readonly accessibility: AccessibilityService;
  public readonly translation: TranslationService;

  constructor() {
    this.ussd = new USSDService();
    this.sms = new SMSService();
    this.voice = new VoiceService();
    this.lowBandwidth = new LowBandwidthService();
    this.accessibility = new AccessibilityService();
    this.translation = new TranslationService();
  }

  /**
   * Initialize all services
   */
  async initialize(): Promise<void> {
    // Load translations for all supported languages
    const languages = this.translation.getSupportedLanguages();
    for (const lang of languages) {
      await this.translation.loadTranslations(lang.code);
    }

    console.log("[OfflinePlatform] Initialized with services:");
    console.log("  - USSD Gateway (feature phones, 2G)");
    console.log("  - SMS Booking (basic phones)");
    console.log("  - Voice/IVR (call center)");
    console.log("  - Low-Bandwidth Optimization");
    console.log("  - Accessibility (WCAG 2.1 AAA)");
    console.log("  - Multi-language Support (20+ languages)");
  }

  /**
   * Determine the best channel for a user based on their context
   */
  getBestChannel(context: {
    device: "smartphone" | "feature_phone" | "basic_phone";
    network: "wifi" | "4g" | "3g" | "2g" | "offline";
    hasData: boolean;
    preferredChannel?: string;
  }): "app" | "ussd" | "sms" | "voice" {
    // User preference takes priority if available
    if (context.preferredChannel) {
      return context.preferredChannel as "app" | "ussd" | "sms" | "voice";
    }

    // Basic phones can only use SMS or voice
    if (context.device === "basic_phone") {
      return "sms";
    }

    // Feature phones prefer USSD
    if (context.device === "feature_phone") {
      return "ussd";
    }

    // Smartphones with poor connectivity
    if (context.network === "2g" || context.network === "offline") {
      return context.hasData ? "ussd" : "sms";
    }

    // Smartphones with no data
    if (!context.hasData) {
      return "ussd";
    }

    // Default to app
    return "app";
  }

  /**
   * Get platform statistics
   */
  getStats(): {
    supportedLanguages: number;
    supportedChannels: string[];
    wcagLevel: string;
    targetUsers: string;
  } {
    return {
      supportedLanguages: this.translation.getSupportedLanguages().length,
      supportedChannels: ["App", "USSD", "SMS", "Voice/IVR", "Call Center"],
      wcagLevel: "AAA",
      targetUsers: "100M+ in low-connectivity environments",
    };
  }
}

// Default export
export default OfflinePlatform;
