/**
 * Card Issuance Service
 * Virtual and physical card management
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import type {
  Card,
  CardAuthorizationRequest,
  CardAuthorizationResult,
  CardControls,
  CardDetails,
  CardLimits,
  CardNetwork,
  CardStatus,
  CardTransaction,
  CardType,
  CreateCardParams,
} from "../types/fintech.types";
import { enhancedWalletService } from "./enhanced-wallet.service";

// ===========================================
// CONSTANTS
// ===========================================

const MAX_VIRTUAL_CARDS = 5;
const MAX_PHYSICAL_CARDS = 2;
const VIRTUAL_CARD_FEE = 0; // Free virtual cards
const PHYSICAL_CARD_FEE = 1500; // Card issuance fee

const DEFAULT_LIMITS: CardLimits = {
  dailySpend: 100000,
  dailyWithdrawal: 50000,
  singleTransaction: 50000,
  monthlySpend: 500000,
};

const DEFAULT_CONTROLS: CardControls = {
  onlineEnabled: true,
  atmEnabled: true,
  posEnabled: true,
  internationalEnabled: false,
  contactlessEnabled: true,
};

// ===========================================
// CARD SERVICE
// ===========================================

export class CardService {
  /**
   * Create a new card
   */
  async createCard(params: CreateCardParams): Promise<Card> {
    const { walletId, type, name, currency, pin } = params;

    // Verify wallet exists and check tier
    const wallet = await enhancedWalletService.getWalletById(walletId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    if (!wallet.features.cards) {
      throw new Error(
        `Card feature not available for ${wallet.tier} tier. Upgrade to access cards.`
      );
    }

    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    // Check card limits
    const existingCards = await prisma.card.count({
      where: {
        walletId,
        type,
        status: { not: "TERMINATED" },
      },
    });

    const maxCards =
      type === "VIRTUAL" ? MAX_VIRTUAL_CARDS : MAX_PHYSICAL_CARDS;
    if (existingCards >= maxCards) {
      throw new Error(
        `Maximum ${maxCards} ${type.toLowerCase()} cards allowed`
      );
    }

    // Check fee for physical cards
    const fee = type === "PHYSICAL" ? PHYSICAL_CARD_FEE : VIRTUAL_CARD_FEE;
    if (fee > 0) {
      const balance = await enhancedWalletService.getBalance(
        walletId,
        currency
      );
      if (balance.available < fee) {
        throw new Error("Insufficient balance for card issuance fee");
      }

      // Deduct fee
      await enhancedWalletService.debit({
        walletId,
        amount: fee,
        currency,
        description: `${type} card issuance fee`,
        reference: `card_fee_${nanoid(8)}`,
      });
    }

    // Generate card details
    const cardId = `card_${nanoid(16)}`;
    const cardNumber = this.generateCardNumber();
    const cvv = this.generateCVV();
    const expiryDate = this.calculateExpiryDate();
    const cardPin = this.generateCardPIN();

    // Create card
    const card = await prisma.card.create({
      data: {
        id: cardId,
        walletId,
        type,
        name: name || `${type} Card`,
        last4: cardNumber.slice(-4),
        cardNumberEncrypted: this.encryptCardNumber(cardNumber),
        cvvEncrypted: this.encryptCVV(cvv),
        expiryMonth: expiryDate.month,
        expiryYear: expiryDate.year,
        pinEncrypted: this.encryptPIN(cardPin),
        network: "VISA",
        currency,
        status: type === "VIRTUAL" ? "ACTIVE" : "PENDING_ACTIVATION",
        limits: DEFAULT_LIMITS,
        controls: DEFAULT_CONTROLS,
        issuanceFee: fee,
      },
    });

    // For physical cards, initiate shipping process
    if (type === "PHYSICAL") {
      await this.initiateCardShipping(cardId);
    }

    return this.formatCard(card, false);
  }

  /**
   * Get all cards for a wallet
   */
  async getCards(walletId: string): Promise<Card[]> {
    const cards = await prisma.card.findMany({
      where: { walletId, status: { not: "TERMINATED" } },
      orderBy: { createdAt: "desc" },
    });

    return cards.map((c) => this.formatCard(c, false));
  }

  /**
   * Get card details (including sensitive info)
   */
  async getCardDetails(
    cardId: string,
    walletId: string,
    pin: string
  ): Promise<CardDetails> {
    // Verify wallet PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    const card = await prisma.card.findUnique({
      where: { id: cardId },
    });

    if (!card || card.walletId !== walletId) {
      throw new Error("Card not found");
    }

    // Decrypt and return full details
    return {
      id: card.id,
      type: card.type as CardType,
      name: card.name,
      cardNumber: this.decryptCardNumber(card.cardNumberEncrypted),
      cvv: this.decryptCVV(card.cvvEncrypted),
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      network: card.network as CardNetwork,
      status: card.status as CardStatus,
    };
  }

  /**
   * Activate physical card
   */
  async activateCard(
    cardId: string,
    walletId: string,
    activationCode: string
  ): Promise<void> {
    const card = await prisma.card.findUnique({
      where: { id: cardId },
    });

    if (!card || card.walletId !== walletId) {
      throw new Error("Card not found");
    }

    if (card.type !== "PHYSICAL") {
      throw new Error("Only physical cards need activation");
    }

    if (card.status !== "PENDING_ACTIVATION") {
      throw new Error(`Card is ${card.status.toLowerCase()}`);
    }

    // Verify activation code (sent with card)
    // In production, compare with stored activation code
    if (activationCode.length !== 6 || !/^\d+$/.test(activationCode)) {
      throw new Error("Invalid activation code");
    }

    await prisma.card.update({
      where: { id: cardId },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
      },
    });
  }

  /**
   * Freeze/unfreeze card
   */
  async setCardFreeze(
    cardId: string,
    walletId: string,
    freeze: boolean
  ): Promise<void> {
    const card = await prisma.card.findUnique({
      where: { id: cardId },
    });

    if (!card || card.walletId !== walletId) {
      throw new Error("Card not found");
    }

    if (card.status === "TERMINATED" || card.status === "EXPIRED") {
      throw new Error(
        `Cannot ${freeze ? "freeze" : "unfreeze"} ${card.status.toLowerCase()} card`
      );
    }

    await prisma.card.update({
      where: { id: cardId },
      data: {
        status: freeze ? "FROZEN" : "ACTIVE",
      },
    });
  }

  /**
   * Update card limits
   */
  async updateLimits(
    cardId: string,
    walletId: string,
    pin: string,
    limits: Partial<CardLimits>
  ): Promise<Card> {
    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    const card = await prisma.card.findUnique({
      where: { id: cardId },
    });

    if (!card || card.walletId !== walletId) {
      throw new Error("Card not found");
    }

    const currentLimits = card.limits as CardLimits;
    const newLimits = { ...currentLimits, ...limits };

    const updated = await prisma.card.update({
      where: { id: cardId },
      data: { limits: newLimits },
    });

    return this.formatCard(updated, false);
  }

  /**
   * Update card controls
   */
  async updateControls(
    cardId: string,
    walletId: string,
    controls: Partial<CardControls>
  ): Promise<Card> {
    const card = await prisma.card.findUnique({
      where: { id: cardId },
    });

    if (!card || card.walletId !== walletId) {
      throw new Error("Card not found");
    }

    const currentControls = card.controls as CardControls;
    const newControls = { ...currentControls, ...controls };

    const updated = await prisma.card.update({
      where: { id: cardId },
      data: { controls: newControls },
    });

    return this.formatCard(updated, false);
  }

  /**
   * Set card PIN
   */
  async setCardPIN(
    cardId: string,
    walletId: string,
    walletPin: string,
    newCardPin: string
  ): Promise<void> {
    // Verify wallet PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, walletPin);
    if (!pinValid) {
      throw new Error("Invalid wallet PIN");
    }

    const card = await prisma.card.findUnique({
      where: { id: cardId },
    });

    if (!card || card.walletId !== walletId) {
      throw new Error("Card not found");
    }

    if (!/^\d{4}$/.test(newCardPin)) {
      throw new Error("Card PIN must be 4 digits");
    }

    await prisma.card.update({
      where: { id: cardId },
      data: {
        pinEncrypted: this.encryptPIN(newCardPin),
      },
    });
  }

  /**
   * Terminate card
   */
  async terminateCard(
    cardId: string,
    walletId: string,
    pin: string,
    reason?: string
  ): Promise<void> {
    // Verify PIN
    const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
    if (!pinValid) {
      throw new Error("Invalid PIN");
    }

    const card = await prisma.card.findUnique({
      where: { id: cardId },
    });

    if (!card || card.walletId !== walletId) {
      throw new Error("Card not found");
    }

    await prisma.card.update({
      where: { id: cardId },
      data: {
        status: "TERMINATED",
        terminatedAt: new Date(),
        metadata: {
          ...((card.metadata as object) || {}),
          terminationReason: reason,
        },
      },
    });
  }

  /**
   * Process card authorization (called by card network)
   */
  async processAuthorization(
    request: CardAuthorizationRequest
  ): Promise<CardAuthorizationResult> {
    const {
      cardId,
      amount,
      currency,
      merchantName,
      merchantCategory,
      transactionType,
    } = request;

    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: { wallet: true },
    });

    if (!card) {
      return { approved: false, declineReason: "CARD_NOT_FOUND" };
    }

    // Check card status
    if (card.status !== "ACTIVE") {
      return { approved: false, declineReason: "CARD_NOT_ACTIVE" };
    }

    // Check controls
    const controls = card.controls as CardControls;
    if (transactionType === "ONLINE" && !controls.onlineEnabled) {
      return { approved: false, declineReason: "ONLINE_DISABLED" };
    }
    if (transactionType === "ATM" && !controls.atmEnabled) {
      return { approved: false, declineReason: "ATM_DISABLED" };
    }
    if (transactionType === "POS" && !controls.posEnabled) {
      return { approved: false, declineReason: "POS_DISABLED" };
    }

    // Check limits
    const limits = card.limits as CardLimits;
    if (amount > limits.singleTransaction) {
      return { approved: false, declineReason: "EXCEEDS_SINGLE_LIMIT" };
    }

    // Check daily spend
    const dailySpent = await this.getDailySpend(cardId);
    if (dailySpent + amount > limits.dailySpend) {
      return { approved: false, declineReason: "EXCEEDS_DAILY_LIMIT" };
    }

    // Check balance
    const balance = await enhancedWalletService.getBalance(
      card.walletId,
      currency
    );
    if (balance.available < amount) {
      return { approved: false, declineReason: "INSUFFICIENT_BALANCE" };
    }

    // Create authorization hold
    const authId = `auth_${nanoid(16)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 day hold

    await prisma.cardAuthorizationHold.create({
      data: {
        id: authId,
        cardId,
        amount,
        currency,
        merchantName,
        merchantCategory,
        transactionType,
        expiresAt,
        status: "PENDING",
      },
    });

    // Hold funds in wallet
    await enhancedWalletService.hold({
      walletId: card.walletId,
      amount,
      currency,
      reason: `Card authorization - ${merchantName}`,
      reference: authId,
      expiresInMinutes: 7 * 24 * 60,
    });

    return {
      approved: true,
      authorizationId: authId,
      availableBalance: balance.available - amount,
    };
  }

  /**
   * Capture authorized transaction
   */
  async captureTransaction(
    authorizationId: string,
    amount?: number
  ): Promise<void> {
    const auth = await prisma.cardAuthorizationHold.findUnique({
      where: { id: authorizationId },
      include: { card: true },
    });

    if (!auth || auth.status !== "PENDING") {
      throw new Error("Authorization not found or already processed");
    }

    const captureAmount = amount ?? Number(auth.amount);

    // Capture the hold
    await enhancedWalletService.captureHold(authorizationId, captureAmount);

    // Create transaction record
    await prisma.cardTransaction.create({
      data: {
        id: `ctxn_${nanoid(16)}`,
        cardId: auth.cardId,
        authorizationId: auth.id,
        amount: captureAmount,
        currency: auth.currency,
        merchantName: auth.merchantName,
        merchantCategory: auth.merchantCategory,
        transactionType: auth.transactionType,
        status: "COMPLETED",
      },
    });

    // Update authorization
    await prisma.cardAuthorizationHold.update({
      where: { id: authorizationId },
      data: {
        status: "CAPTURED",
        capturedAmount: captureAmount,
        capturedAt: new Date(),
      },
    });

    // Update card statistics
    await prisma.card.update({
      where: { id: auth.cardId },
      data: {
        totalSpent: { increment: captureAmount },
        transactionCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Void authorization
   */
  async voidAuthorization(authorizationId: string): Promise<void> {
    const auth = await prisma.cardAuthorizationHold.findUnique({
      where: { id: authorizationId },
    });

    if (!auth || auth.status !== "PENDING") {
      throw new Error("Authorization not found or already processed");
    }

    // Release the hold
    await enhancedWalletService.releaseHold(authorizationId);

    // Update authorization
    await prisma.cardAuthorizationHold.update({
      where: { id: authorizationId },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
      },
    });
  }

  /**
   * Get card transactions
   */
  async getTransactions(
    cardId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ transactions: CardTransaction[]; total: number }> {
    const { limit = 20, offset = 0 } = options;

    const [transactions, total] = await Promise.all([
      prisma.cardTransaction.findMany({
        where: { cardId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.cardTransaction.count({ where: { cardId } }),
    ]);

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        cardId: t.cardId,
        amount: Number(t.amount),
        currency: t.currency,
        merchantName: t.merchantName,
        merchantCategory: t.merchantCategory || undefined,
        transactionType: t.transactionType as
          | "ONLINE"
          | "ATM"
          | "POS"
          | "CONTACTLESS",
        status: t.status as "COMPLETED" | "PENDING" | "DECLINED" | "REFUNDED",
        createdAt: t.createdAt,
      })),
      total,
    };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private formatCard(
    card: {
      id: string;
      walletId: string;
      type: string;
      name: string;
      last4: string;
      expiryMonth: number;
      expiryYear: number;
      network: string;
      currency: string;
      status: string;
      limits: unknown;
      controls: unknown;
      totalSpent: unknown;
      transactionCount: number;
      createdAt: Date;
      lastUsedAt: Date | null;
    },
    includeSensitive: boolean
  ): Card {
    return {
      id: card.id,
      walletId: card.walletId,
      type: card.type as CardType,
      name: card.name,
      last4: card.last4,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      network: card.network as CardNetwork,
      currency: card.currency as Currency,
      status: card.status as CardStatus,
      limits: card.limits as CardLimits,
      controls: card.controls as CardControls,
      totalSpent: Number(card.totalSpent),
      transactionCount: card.transactionCount,
      createdAt: card.createdAt,
      lastUsedAt: card.lastUsedAt || undefined,
    };
  }

  private generateCardNumber(): string {
    // Generate a valid-looking 16 digit card number
    // In production, this would come from the card processor
    const bin = "400000"; // Example BIN
    let cardNumber = bin;
    for (let i = 0; i < 9; i++) {
      cardNumber += Math.floor(Math.random() * 10);
    }
    // Add Luhn check digit
    cardNumber += this.calculateLuhnDigit(cardNumber);
    return cardNumber;
  }

  private calculateLuhnDigit(cardNumber: string): string {
    let sum = 0;
    let isEven = true;
    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i], 10);
      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      isEven = !isEven;
    }
    return String((10 - (sum % 10)) % 10);
  }

  private generateCVV(): string {
    return String(Math.floor(100 + Math.random() * 900));
  }

  private generateCardPIN(): string {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  private calculateExpiryDate(): { month: number; year: number } {
    const now = new Date();
    const expiryDate = new Date(now.getFullYear() + 4, now.getMonth(), 1);
    return {
      month: expiryDate.getMonth() + 1,
      year: expiryDate.getFullYear(),
    };
  }

  private encryptCardNumber(cardNumber: string): string {
    // In production, use proper encryption (HSM)
    return Buffer.from(cardNumber).toString("base64");
  }

  private decryptCardNumber(encrypted: string): string {
    return Buffer.from(encrypted, "base64").toString("utf-8");
  }

  private encryptCVV(cvv: string): string {
    return Buffer.from(cvv).toString("base64");
  }

  private decryptCVV(encrypted: string): string {
    return Buffer.from(encrypted, "base64").toString("utf-8");
  }

  private encryptPIN(pin: string): string {
    return Buffer.from(pin).toString("base64");
  }

  private async getDailySpend(cardId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const transactions = await prisma.cardTransaction.aggregate({
      where: {
        cardId,
        status: "COMPLETED",
        createdAt: { gte: today },
      },
      _sum: { amount: true },
    });

    return Number(transactions._sum.amount || 0);
  }

  private async initiateCardShipping(cardId: string): Promise<void> {
    // In production, integrate with card fulfillment provider
    console.log(`[Cards] Initiated shipping for card ${cardId}`);
  }
}

// Export singleton instance
export const cardService = new CardService();
