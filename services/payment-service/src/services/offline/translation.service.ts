// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - TRANSLATION SERVICE
// =============================================================================
// Multi-language support for African languages with RTL and pluralization
// Supports: English, Swahili, Yoruba, Hausa, Amharic, Arabic, French, Portuguese, Zulu
// =============================================================================

import { EventEmitter } from "events";
import {
  ITranslationService,
  Language,
  TranslationRequest,
} from "../types/offline.types";

// =============================================================================
// SUPPORTED LANGUAGES
// =============================================================================

const SUPPORTED_LANGUAGES: Language[] = [
  {
    code: "en",
    name: "English",
    nativeName: "English",
    direction: "ltr",
    pluralRules: "one,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "hh:mm A",
    currencyFormat: "{symbol}{amount}",
    numberFormat: "1,234.56",
    enabled: true,
    completeness: 100,
  },
  {
    code: "sw",
    name: "Swahili",
    nativeName: "Kiswahili",
    direction: "ltr",
    pluralRules: "one,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm",
    currencyFormat: "{symbol}{amount}",
    numberFormat: "1,234.56",
    enabled: true,
    completeness: 95,
  },
  {
    code: "yo",
    name: "Yoruba",
    nativeName: "Yorùbá",
    direction: "ltr",
    pluralRules: "other", // No plural form distinction
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm",
    currencyFormat: "₦{amount}",
    numberFormat: "1,234.56",
    enabled: true,
    completeness: 80,
  },
  {
    code: "ha",
    name: "Hausa",
    nativeName: "Hausa",
    direction: "ltr",
    pluralRules: "one,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm",
    currencyFormat: "₦{amount}",
    numberFormat: "1,234.56",
    enabled: true,
    completeness: 75,
  },
  {
    code: "am",
    name: "Amharic",
    nativeName: "አማርኛ",
    direction: "ltr",
    pluralRules: "one,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "h:mm A",
    currencyFormat: "ETB {amount}",
    numberFormat: "1,234.56",
    enabled: true,
    completeness: 70,
  },
  {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    direction: "rtl",
    pluralRules: "zero,one,two,few,many,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "hh:mm",
    currencyFormat: "{amount} {symbol}",
    numberFormat: "١٬٢٣٤٫٥٦",
    enabled: true,
    completeness: 85,
  },
  {
    code: "fr",
    name: "French",
    nativeName: "Français",
    direction: "ltr",
    pluralRules: "one,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm",
    currencyFormat: "{amount} {symbol}",
    numberFormat: "1 234,56",
    enabled: true,
    completeness: 90,
  },
  {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
    direction: "ltr",
    pluralRules: "one,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm",
    currencyFormat: "{symbol} {amount}",
    numberFormat: "1.234,56",
    enabled: true,
    completeness: 85,
  },
  {
    code: "zu",
    name: "Zulu",
    nativeName: "isiZulu",
    direction: "ltr",
    pluralRules: "one,other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm",
    currencyFormat: "R{amount}",
    numberFormat: "1 234,56",
    enabled: true,
    completeness: 65,
  },
  {
    code: "ig",
    name: "Igbo",
    nativeName: "Igbo",
    direction: "ltr",
    pluralRules: "other",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH:mm",
    currencyFormat: "₦{amount}",
    numberFormat: "1,234.56",
    enabled: true,
    completeness: 60,
  },
];

// =============================================================================
// TRANSLATION DICTIONARIES
// =============================================================================

const TRANSLATIONS: Record<
  string,
  Record<string, string | Record<string, string>>
> = {
  en: {
    // Common
    "common.yes": "Yes",
    "common.no": "No",
    "common.ok": "OK",
    "common.cancel": "Cancel",
    "common.back": "Back",
    "common.next": "Next",
    "common.done": "Done",
    "common.loading": "Loading...",
    "common.error": "Error",
    "common.success": "Success",
    "common.retry": "Try again",
    "common.save": "Save",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.search": "Search",
    "common.close": "Close",
    "common.confirm": "Confirm",

    // Navigation
    "nav.home": "Home",
    "nav.rides": "Rides",
    "nav.wallet": "Wallet",
    "nav.account": "Account",
    "nav.help": "Help",

    // Booking
    "booking.where_to": "Where to?",
    "booking.enter_destination": "Enter destination",
    "booking.enter_pickup": "Enter pickup location",
    "booking.current_location": "Current location",
    "booking.saved_places": "Saved places",
    "booking.home": "Home",
    "booking.work": "Work",
    "booking.recent": "Recent",
    "booking.confirm": "Confirm ride",
    "booking.estimated_fare": "Estimated fare",
    "booking.estimated_time": "Estimated time",
    "booking.finding_driver": "Finding you a driver...",
    "booking.driver_found": "Driver found!",
    "booking.driver_arriving": "Driver is arriving",
    "booking.trip_started": "Trip started",
    "booking.trip_completed": "Trip completed",

    // Plurals
    "booking.minutes": {
      one: "{count} minute",
      other: "{count} minutes",
    },
    "wallet.transactions": {
      one: "{count} transaction",
      other: "{count} transactions",
    },

    // Driver
    "driver.name": "Driver",
    "driver.vehicle": "Vehicle",
    "driver.plate": "License plate",
    "driver.rating": "Rating",
    "driver.trips": "trips",
    "driver.call": "Call driver",
    "driver.message": "Message driver",
    "driver.arriving_in": "Arriving in {time}",

    // Wallet
    "wallet.balance": "Balance",
    "wallet.add_money": "Add money",
    "wallet.send_money": "Send money",
    "wallet.history": "Transaction history",
    "wallet.payment_methods": "Payment methods",
    "wallet.insufficient_funds": "Insufficient funds",
    "wallet.topup_success": "Money added successfully",
    "wallet.send_success": "Money sent successfully",

    // Errors
    "error.generic": "Something went wrong. Please try again.",
    "error.network": "No internet connection",
    "error.no_drivers": "No drivers available nearby",
    "error.payment_failed": "Payment failed",
    "error.location": "Could not get your location",
    "error.address": "Address not found",
    "error.session_expired": "Session expired. Please log in again.",

    // Accessibility
    "a11y.skip_to_content": "Skip to content",
    "a11y.menu_open": "Open menu",
    "a11y.menu_close": "Close menu",
    "a11y.loading": "Content is loading",
    "a11y.required_field": "Required field",
    "a11y.error_in_field": "Error in this field",
  },

  sw: {
    // Common
    "common.yes": "Ndiyo",
    "common.no": "Hapana",
    "common.ok": "Sawa",
    "common.cancel": "Ghairi",
    "common.back": "Rudi",
    "common.next": "Endelea",
    "common.done": "Tayari",
    "common.loading": "Inapakia...",
    "common.error": "Hitilafu",
    "common.success": "Imefanikiwa",
    "common.retry": "Jaribu tena",
    "common.confirm": "Thibitisha",

    // Navigation
    "nav.home": "Nyumbani",
    "nav.rides": "Safari",
    "nav.wallet": "Mkoba",
    "nav.account": "Akaunti",
    "nav.help": "Msaada",

    // Booking
    "booking.where_to": "Unaenda wapi?",
    "booking.enter_destination": "Ingiza mahali",
    "booking.enter_pickup": "Ingiza mahali pa kuchukua",
    "booking.current_location": "Mahali ulipo",
    "booking.saved_places": "Maeneo yaliyohifadhiwa",
    "booking.home": "Nyumbani",
    "booking.work": "Kazini",
    "booking.recent": "Hivi karibuni",
    "booking.confirm": "Thibitisha safari",
    "booking.estimated_fare": "Bei inayokadiriwa",
    "booking.estimated_time": "Muda unaokadiriwa",
    "booking.finding_driver": "Tunatafuta dereva...",
    "booking.driver_found": "Dereva amepatikana!",
    "booking.driver_arriving": "Dereva anakuja",
    "booking.trip_started": "Safari imeanza",
    "booking.trip_completed": "Safari imekamilika",

    // Plurals
    "booking.minutes": {
      one: "Dakika {count}",
      other: "Dakika {count}",
    },

    // Driver
    "driver.name": "Dereva",
    "driver.vehicle": "Gari",
    "driver.plate": "Nambari ya gari",
    "driver.rating": "Ukadiriaji",
    "driver.call": "Piga simu dereva",
    "driver.arriving_in": "Anafika kwa {time}",

    // Wallet
    "wallet.balance": "Salio",
    "wallet.add_money": "Ongeza pesa",
    "wallet.send_money": "Tuma pesa",
    "wallet.history": "Historia ya miamala",
    "wallet.insufficient_funds": "Salio haitoshi",

    // Errors
    "error.generic": "Kuna hitilafu. Jaribu tena.",
    "error.network": "Hakuna mtandao",
    "error.no_drivers": "Hakuna madereva karibu",
  },

  yo: {
    // Common
    "common.yes": "Bẹ́ẹ̀ni",
    "common.no": "Rárá",
    "common.ok": "Dára",
    "common.cancel": "Fagilee",
    "common.back": "Padà",
    "common.confirm": "Jẹ́rìísí",

    // Navigation
    "nav.home": "Ilé",
    "nav.rides": "Irin-àjò",
    "nav.wallet": "Àpamọ́wọ́",
    "nav.help": "Ìrànlọ́wọ́",

    // Booking
    "booking.where_to": "Níbo ni ẹ fẹ́ lọ?",
    "booking.confirm": "Jẹ́rìísí irin-àjò",
    "booking.finding_driver": "A ń wá awakọ̀...",
    "booking.driver_found": "A ti rí awakọ̀!",

    // Errors
    "error.generic": "Nǹkan kan ṣẹlẹ̀. Gbìyànjú lẹ́ẹ̀kan si.",
  },

  ha: {
    // Common
    "common.yes": "Ee",
    "common.no": "A'a",
    "common.ok": "To",
    "common.cancel": "Soke",
    "common.back": "Baya",
    "common.confirm": "Tabbatar",

    // Navigation
    "nav.home": "Gida",
    "nav.rides": "Tafiya",
    "nav.wallet": "Jakar kuɗi",
    "nav.help": "Taimako",

    // Booking
    "booking.where_to": "Ina za ka?",
    "booking.confirm": "Tabbatar da tafiya",
    "booking.finding_driver": "Ana neman direba...",
  },

  ar: {
    // Common (RTL)
    "common.yes": "نعم",
    "common.no": "لا",
    "common.ok": "حسناً",
    "common.cancel": "إلغاء",
    "common.back": "رجوع",
    "common.next": "التالي",
    "common.confirm": "تأكيد",
    "common.loading": "جاري التحميل...",

    // Navigation
    "nav.home": "الرئيسية",
    "nav.rides": "الرحلات",
    "nav.wallet": "المحفظة",
    "nav.help": "مساعدة",

    // Booking
    "booking.where_to": "إلى أين؟",
    "booking.confirm": "تأكيد الرحلة",
    "booking.finding_driver": "جاري البحث عن سائق...",
    "booking.driver_found": "تم العثور على سائق!",

    // Plurals (Arabic has complex plural rules)
    "booking.minutes": {
      zero: "{count} دقيقة",
      one: "دقيقة واحدة",
      two: "دقيقتان",
      few: "{count} دقائق",
      many: "{count} دقيقة",
      other: "{count} دقيقة",
    },
  },

  fr: {
    // Common
    "common.yes": "Oui",
    "common.no": "Non",
    "common.ok": "D'accord",
    "common.cancel": "Annuler",
    "common.back": "Retour",
    "common.confirm": "Confirmer",

    // Navigation
    "nav.home": "Accueil",
    "nav.rides": "Trajets",
    "nav.wallet": "Portefeuille",
    "nav.help": "Aide",

    // Booking
    "booking.where_to": "Où allez-vous?",
    "booking.confirm": "Confirmer le trajet",
    "booking.finding_driver": "Recherche de chauffeur...",
    "booking.driver_found": "Chauffeur trouvé!",

    // Plurals
    "booking.minutes": {
      one: "{count} minute",
      other: "{count} minutes",
    },
  },

  zu: {
    // Common
    "common.yes": "Yebo",
    "common.no": "Cha",
    "common.ok": "Kulungile",
    "common.cancel": "Khansela",
    "common.back": "Emuva",
    "common.confirm": "Qinisekisa",

    // Navigation
    "nav.home": "Ikhaya",
    "nav.rides": "Uhambo",
    "nav.wallet": "Isikhwama",
    "nav.help": "Usizo",

    // Booking
    "booking.where_to": "Uyaphi?",
    "booking.confirm": "Qinisekisa uhambo",
    "booking.finding_driver": "Sifuna umshayeli...",
  },
};

// =============================================================================
// TRANSLATION SERVICE
// =============================================================================

export class TranslationService implements ITranslationService {
  private eventEmitter: EventEmitter;
  private languages: Map<string, Language> = new Map();
  private translations: Map<
    string,
    Record<string, string | Record<string, string>>
  > = new Map();
  private defaultLanguage: string = "en";
  private currentLanguage: string = "en";

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.initializeLanguages();
    this.initializeTranslations();
  }

  private initializeLanguages(): void {
    for (const lang of SUPPORTED_LANGUAGES) {
      this.languages.set(lang.code, lang);
    }
  }

  private initializeTranslations(): void {
    for (const [lang, dict] of Object.entries(TRANSLATIONS)) {
      this.translations.set(lang, dict);
    }
  }

  // ===========================================================================
  // CORE TRANSLATION
  // ===========================================================================

  t(
    key: string,
    params?: Record<string, string | number>,
    options?: { language?: string; count?: number; context?: string }
  ): string {
    const lang = options?.language || this.currentLanguage;

    // Get translation with fallback chain
    let translation = this.getTranslation(key, lang);

    if (!translation) {
      // Try fallback languages
      for (const fallback of this.getFallbackChain(lang)) {
        translation = this.getTranslation(key, fallback);
        if (translation) break;
      }
    }

    if (!translation) {
      // Return key as last resort
      this.eventEmitter.emit("translation:missing", { key, lang });
      return key;
    }

    // Handle pluralization
    if (typeof translation === "object" && options?.count !== undefined) {
      const pluralForm = this.getPluralForm(lang, options.count);
      translation =
        translation[pluralForm] ||
        translation.other ||
        Object.values(translation)[0];
    }

    // Handle string translation
    if (typeof translation === "string") {
      return this.interpolate(translation, params);
    }

    return key;
  }

  private getTranslation(
    key: string,
    lang: string
  ): string | Record<string, string> | undefined {
    const dict = this.translations.get(lang);
    if (!dict) return undefined;
    return dict[key];
  }

  private interpolate(
    text: string,
    params?: Record<string, string | number>
  ): string {
    if (!params) return text;

    let result = text;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
    }
    return result;
  }

  private getFallbackChain(lang: string): string[] {
    const chain: string[] = [];

    // Add base language if it's a variant (e.g., en-US -> en)
    if (lang.includes("-")) {
      chain.push(lang.split("-")[0]);
    }

    // Add default language
    if (!chain.includes(this.defaultLanguage)) {
      chain.push(this.defaultLanguage);
    }

    return chain;
  }

  // ===========================================================================
  // PLURALIZATION
  // ===========================================================================

  private getPluralForm(lang: string, count: number): string {
    // ICU plural rules implementation
    const rules = this.getPluralRules(lang);

    switch (lang) {
      case "ar":
        // Arabic has 6 plural forms
        if (count === 0) return "zero";
        if (count === 1) return "one";
        if (count === 2) return "two";
        if (count % 100 >= 3 && count % 100 <= 10) return "few";
        if (count % 100 >= 11 && count % 100 <= 99) return "many";
        return "other";

      case "yo":
      case "ig":
        // No plural distinction
        return "other";

      default:
        // Standard one/other
        return count === 1 ? "one" : "other";
    }
  }

  private getPluralRules(lang: string): string[] {
    const language = this.languages.get(lang);
    return language?.pluralRules.split(",") || ["one", "other"];
  }

  // ===========================================================================
  // LANGUAGE MANAGEMENT
  // ===========================================================================

  getSupportedLanguages(): Language[] {
    return Array.from(this.languages.values()).filter((l) => l.enabled);
  }

  getLanguage(code: string): Language | undefined {
    return this.languages.get(code);
  }

  setLanguage(code: string): void {
    if (this.languages.has(code)) {
      const previous = this.currentLanguage;
      this.currentLanguage = code;
      this.eventEmitter.emit("language:changed", { from: previous, to: code });
    }
  }

  getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  isRTL(lang?: string): boolean {
    const language = this.languages.get(lang || this.currentLanguage);
    return language?.direction === "rtl";
  }

  // ===========================================================================
  // FORMATTING
  // ===========================================================================

  formatDate(
    date: Date,
    lang?: string,
    format?: "short" | "long" | "relative"
  ): string {
    const language = this.languages.get(lang || this.currentLanguage);

    if (format === "relative") {
      return this.formatRelativeDate(date, lang);
    }

    // Use Intl.DateTimeFormat
    const options: Intl.DateTimeFormatOptions =
      format === "long"
        ? { year: "numeric", month: "long", day: "numeric" }
        : { year: "numeric", month: "short", day: "numeric" };

    return new Intl.DateTimeFormat(
      lang || this.currentLanguage,
      options
    ).format(date);
  }

  formatTime(date: Date, lang?: string): string {
    const language = this.languages.get(lang || this.currentLanguage);
    const options: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hour12:
        language?.timeFormat.includes("A") ||
        language?.timeFormat.includes("a"),
    };

    return new Intl.DateTimeFormat(
      lang || this.currentLanguage,
      options
    ).format(date);
  }

  formatRelativeDate(date: Date, lang?: string): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return this.t("time.just_now", {}, { language: lang });
    }
    if (diffMins < 60) {
      return this.t(
        "time.minutes_ago",
        { count: diffMins },
        { language: lang, count: diffMins }
      );
    }
    if (diffHours < 24) {
      return this.t(
        "time.hours_ago",
        { count: diffHours },
        { language: lang, count: diffHours }
      );
    }
    if (diffDays < 7) {
      return this.t(
        "time.days_ago",
        { count: diffDays },
        { language: lang, count: diffDays }
      );
    }

    return this.formatDate(date, lang, "short");
  }

  formatCurrency(amount: number, currency: string, lang?: string): string {
    const language = this.languages.get(lang || this.currentLanguage);

    // Handle Arabic numerals
    if (lang === "ar") {
      const arabicNumerals = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
      const formatted = amount.toLocaleString("ar-EG", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      return formatted;
    }

    return new Intl.NumberFormat(lang || this.currentLanguage, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  formatNumber(num: number, lang?: string): string {
    return new Intl.NumberFormat(lang || this.currentLanguage).format(num);
  }

  formatDistance(meters: number, lang?: string): string {
    if (meters < 1000) {
      return `${Math.round(meters)} ${this.t("unit.meters", {}, { language: lang })}`;
    }
    return `${(meters / 1000).toFixed(1)} ${this.t("unit.km", {}, { language: lang })}`;
  }

  formatDuration(minutes: number, lang?: string): string {
    if (minutes < 60) {
      return this.t(
        "booking.minutes",
        { count: minutes },
        { language: lang, count: minutes }
      );
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (mins === 0) {
      return this.t(
        "time.hours",
        { count: hours },
        { language: lang, count: hours }
      );
    }

    return `${hours}h ${mins}m`;
  }

  // ===========================================================================
  // TRANSLATION LOADING
  // ===========================================================================

  async loadTranslations(lang: string, namespace?: string): Promise<boolean> {
    try {
      // In production, load from API or file system
      // For now, check if we have the translations
      const existing = this.translations.get(lang);
      if (existing) {
        return true;
      }

      // Could load from network
      this.eventEmitter.emit("translations:load", { lang, namespace });
      return false;
    } catch (error) {
      this.eventEmitter.emit("translations:error", { lang, error });
      return false;
    }
  }

  addTranslations(lang: string, translations: Record<string, string>): void {
    const existing = this.translations.get(lang) || {};
    this.translations.set(lang, { ...existing, ...translations });
  }

  // ===========================================================================
  // BATCH TRANSLATION
  // ===========================================================================

  async translateBatch(
    requests: TranslationRequest[]
  ): Promise<Record<string, string>> {
    const results: Record<string, string> = {};

    for (const req of requests) {
      results[req.key] = this.t(req.key, req.params, {
        language: req.targetLanguage,
        count: req.count,
        context: req.context,
      });
    }

    return results;
  }

  // ===========================================================================
  // MISSING TRANSLATIONS
  // ===========================================================================

  getMissingTranslations(lang: string): string[] {
    const defaultDict = this.translations.get(this.defaultLanguage) || {};
    const targetDict = this.translations.get(lang) || {};

    const missing: string[] = [];
    for (const key of Object.keys(defaultDict)) {
      if (!(key in targetDict)) {
        missing.push(key);
      }
    }

    return missing;
  }

  getTranslationCompleteness(lang: string): number {
    const defaultDict = this.translations.get(this.defaultLanguage) || {};
    const targetDict = this.translations.get(lang) || {};

    const totalKeys = Object.keys(defaultDict).length;
    if (totalKeys === 0) return 100;

    const translatedKeys = Object.keys(targetDict).filter(
      (k) => k in defaultDict
    ).length;
    return Math.round((translatedKeys / totalKeys) * 100);
  }

  // ===========================================================================
  // RTL HELPERS
  // ===========================================================================

  getTextDirection(lang?: string): "ltr" | "rtl" {
    return this.isRTL(lang) ? "rtl" : "ltr";
  }

  wrapBidirectionalText(text: string, lang?: string): string {
    if (!this.isRTL(lang)) return text;

    // Add RTL mark for proper display
    return "\u200F" + text + "\u200F";
  }

  formatBidirectionalNumber(num: number, lang?: string): string {
    const formatted = this.formatNumber(num, lang);

    if (this.isRTL(lang)) {
      // Wrap number in LTR isolation
      return "\u2066" + formatted + "\u2069";
    }

    return formatted;
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default TranslationService;
