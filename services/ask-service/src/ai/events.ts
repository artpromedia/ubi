/**
 * The SSE event shapes the message endpoint streams (contracts/openapi/ask.yaml,
 * AskEvent oneOf). Every state word here is a server enum; the client renders it
 * and never invents one (rule #21).
 */
import type { Money } from "@ubi/contracts";

export type CardKind = "flight" | "stay" | "ride_estimate" | "ride_quote" | "policy";
export type CardStatus = "suggestion" | "live" | "expired";

export interface Card {
  readonly id: string;
  readonly kind: CardKind;
  readonly status: CardStatus;
  readonly quotedAt?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly price?: Money;
  readonly warnings?: readonly string[];
  /** Opaque; resolves inside travel tools. The model never sees the real offer. */
  readonly offerRef?: string;
  readonly editInForm?: {
    readonly route: string;
    readonly params: Readonly<Record<string, unknown>>;
  };
}

export interface Source {
  readonly title: string;
  readonly ref: string;
  readonly version?: string;
  readonly updatedAt?: string;
}

export type ClarifyKind = "chips" | "passenger" | "date" | "text";

export interface ClarifyField {
  readonly key: string;
  readonly label: string;
  readonly kind: ClarifyKind;
  readonly options?: readonly string[];
  readonly required?: boolean;
}

export type AskEvent =
  | { readonly type: "token"; readonly text: string }
  | { readonly type: "card"; readonly card: Card }
  | { readonly type: "clarify"; readonly fields: readonly ClarifyField[] }
  | { readonly type: "sources"; readonly sources: readonly Source[] }
  | {
      readonly type: "review_ready";
      readonly reviewId: string;
      readonly totals: Money;
    }
  | { readonly type: "refused"; readonly deepLink: string; readonly policy: string }
  | { readonly type: "done" };
