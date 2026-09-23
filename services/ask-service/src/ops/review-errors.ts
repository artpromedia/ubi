/**
 * The two review outcomes the confirm endpoint answers with a body of its own
 * (contracts/openapi/ask.yaml): an expired review (410) and a material change
 * (409 carrying the FRESH review to confirm). Shared by the travel and the
 * marketplace confirm paths.
 */
import { ContractError } from "@ubi/contracts";

import type { ReviewView } from "./review-model";

/** Review has expired — the endpoint answers 410 (contracts/openapi/ask.yaml). */
export class ReviewExpiredError extends ContractError {
  constructor() {
    super("quote_expired", "this review has expired");
    this.name = "ReviewExpiredError";
  }
}

/** Terms changed — the endpoint answers 409 with the fresh review to confirm. */
export class TermsChangedError extends Error {
  readonly code = "terms_changed";
  constructor(readonly review: ReviewView) {
    super("the terms changed; a new review is required");
    this.name = "TermsChangedError";
  }
}
