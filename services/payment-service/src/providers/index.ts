/**
 * Payment Provider Index
 */

// Client classes for direct API calls
export { FlutterwaveClient } from "./flutterwave";
export { PaystackClient } from "./paystack";

// Full service classes with database integration
export { MoMoService } from "./momo.service";
export { MpesaService } from "./mpesa.service";
export {
  createOrangeMoneyService,
  createOrangeMoneyServices,
  OrangeMoneyService,
} from "./orange-money.service";
export { PaystackService } from "./paystack.service";
export { createTelebirrService, TelebirrService } from "./telebirr.service";

import { Currency } from "../types";
import { FlutterwaveClient } from "./flutterwave";
import { PaystackClient } from "./paystack";

/**
 * Payment Provider Factory
 */
export type PaymentProvider = "paystack" | "flutterwave";

export interface ProviderCapabilities {
  currencies: Currency[];
  methods: string[];
  countries: string[];
}

export const PROVIDER_CAPABILITIES: Record<
  PaymentProvider,
  ProviderCapabilities
> = {
  paystack: {
    currencies: [Currency.NGN, Currency.GHS, Currency.ZAR, Currency.KES],
    methods: ["card", "bank_transfer", "ussd", "mobile_money"],
    countries: ["NG", "GH", "ZA", "KE"],
  },
  flutterwave: {
    currencies: [
      Currency.NGN,
      Currency.GHS,
      Currency.KES,
      Currency.UGX,
      Currency.TZS,
      Currency.ZAR,
      Currency.XOF,
      Currency.USD,
    ],
    methods: ["card", "bank_transfer", "ussd", "mobile_money", "mpesa", "qr"],
    countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "RW", "CI", "CM", "SN"],
  },
};

/**
 * Get the best provider for a given currency and country
 */
export function getBestProvider(
  currency: Currency,
  country?: string,
): PaymentProvider {
  // Paystack is preferred for Nigeria due to better rates
  if (currency === Currency.NGN && (!country || country === "NG")) {
    return "paystack";
  }

  // Paystack for Ghana and South Africa
  if (currency === Currency.GHS || currency === Currency.ZAR) {
    return "paystack";
  }

  // Flutterwave for East Africa and Francophone countries
  if (
    [Currency.KES, Currency.UGX, Currency.TZS, Currency.XOF].includes(currency)
  ) {
    return "flutterwave";
  }

  // Default to Flutterwave for wider coverage
  return "flutterwave";
}

/**
 * Create a provider client instance
 */
export function createProviderClient(
  provider: PaymentProvider,
): PaystackClient | FlutterwaveClient {
  switch (provider) {
    case "paystack":
      return new PaystackClient();
    case "flutterwave":
      return new FlutterwaveClient();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
