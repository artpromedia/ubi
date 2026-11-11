// Driver-side marketplace delivery custody & verified proof upload client (CC-C04 / P1-07).
// Gateway proxies `/v1/delivery/*` to `delivery-service`'s `/api/v1/*`.
// Every `delivery-service` JSON response is wrapped in `{ success, data, error }`.
// Server minor-unit integer fields are paired into `Money` objects here at the
// API boundary so screens and containers render them exclusively via `MoneyText`
// without client arithmetic.
import { api, ApiError, type Money } from "@ubi/mobile-core";

export type CustodyProofType = "pickup" | "delivery" | "return";
export type CustodyProofContentType = "image/jpeg" | "image/png" | "image/webp";

export type DeliveryReturnChargeStatus =
  | "not_required"
  | "unsupported"
  | "authorization_required"
  | "reserving"
  | "reserved"
  | "capture_pending"
  | "captured"
  | "released";

export const MAX_PROOF_SIZE_BYTES = 15 * 1024 * 1024; // 15 MiB

export type CustodyContactView = {
  name: string;
  phone: string;
};

export type CustodyProofView = {
  proofId: string;
  type: CustodyProofType;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  verified: boolean;
  createdAt: string;
};

export type CustodyEventView = {
  fromState?: string;
  toState: string;
  actorType: string;
  reason?: string;
  createdAt: string;
};

type CustodyTimelineWire = {
  deliveryId: string;
  state: string;
  version: number;
  delivery?: {
    trackingNumber: string;
    requestId?: string;
    pickupLocation: { address: string; latitude: number; longitude: number };
    dropoffLocation: { address: string; latitude: number; longitude: number };
    pickupContact?: CustodyContactView | null;
    dropoffContact?: CustodyContactView | null;
    package: {
      size: string;
      weightKg: number;
      description: string;
      fragile: boolean;
      requiresSignature: boolean;
    };
    agreedFareMinor?: number;
    currency: string;
  } | null;
  openReturn: {
    returnId: string;
    reason?: string;
    proposedByRole?: string;
    chargeStatus: DeliveryReturnChargeStatus;
    consentState: "pending" | "consented" | "rejected" | "expired";
    consentExpiresAt: string;
    feeMinor: number;
    currency: string;
  } | null;
  returnPolicy?: {
    chargedReturnsOffered: boolean;
    feeFreeOnly: boolean;
  };
  proofs?: CustodyProofView[];
  events: CustodyEventView[];
};

export type DriverCustodyTimeline = {
  deliveryId: string;
  state: string;
  version: number;
  delivery: {
    trackingNumber: string;
    requestId?: string;
    pickupAddress: string;
    dropoffAddress: string;
    pickupContact: CustodyContactView | null;
    dropoffContact: CustodyContactView | null;
    package: {
      size: string;
      weightKg: number;
      description: string;
      fragile: boolean;
      requiresSignature: boolean;
    };
    agreedFare: Money;
    currency: string;
  } | null;
  openReturn: {
    returnId: string;
    reason: string;
    proposedByRole: string;
    chargeStatus: DeliveryReturnChargeStatus;
    consentState: "pending" | "consented" | "rejected" | "expired";
    consentExpiresAt: string;
    hasFee: boolean;
    fee: Money;
  } | null;
  returnPolicy: {
    chargedReturnsOffered: boolean;
    feeFreeOnly: boolean;
  };
  proofs: CustodyProofView[];
  events: CustodyEventView[];
};

export type ProofPhotoCandidate = {
  contentType: CustodyProofContentType;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array | ArrayBuffer | string;
  label?: string;
};

export type ProofUploadDeclaration = {
  type: CustodyProofType;
  contentType: CustodyProofContentType;
  sizeBytes: number;
  sha256: string;
};

export type ProofUploadTarget = {
  method: string;
  url: string;
  headers: Record<string, string>;
};

export type ProofUploadIssued = {
  uploadId: string;
  type: CustodyProofType;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: string;
  replay: boolean;
  upload: ProofUploadTarget;
};

export type ProofAttachResult = {
  proofId: string;
  deliveryId: string;
  type: CustodyProofType;
  replay: boolean;
  custodyState: string;
  verified?: boolean;
  chargeStatus?: DeliveryReturnChargeStatus;
};

export type ProofDownloadUrlResult = {
  proofId: string;
  type: CustodyProofType;
  contentType: string;
  url: string;
  expiresAt: string;
};

export type ProposeReturnResult = {
  returnId: string;
  deliveryId: string;
  custodyState: string;
  chargeStatus: DeliveryReturnChargeStatus;
  consentExpiresAt: string;
};

type DeliveryEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export function unwrapDeliveryEnvelope<T>(raw: unknown): T {
  if (!raw || typeof raw !== "object") {
    throw new ApiError(
      502,
      "invalid_delivery_envelope",
      "Delivery service response was not an object envelope.",
    );
  }
  const env = raw as DeliveryEnvelope<T>;
  if (env.success === false) {
    throw new ApiError(
      400,
      env.error?.code ?? "delivery_error",
      env.error?.message ?? "Delivery action could not be completed.",
      env.error?.details,
    );
  }
  if (env.success !== true || env.data === undefined || env.data === null) {
    throw new ApiError(
      502,
      "invalid_delivery_envelope",
      "Delivery service response is missing the {success:true,data} envelope.",
    );
  }
  return env.data;
}

const pairMoney = (amountMinor: number, currency: string): Money => ({
  amountMinor,
  currency,
});

export function mapDriverCustodyTimeline(
  w: CustodyTimelineWire,
): DriverCustodyTimeline {
  if (!w || typeof w.state !== "string" || !Array.isArray(w.events)) {
    throw new ApiError(
      502,
      "invalid_custody_timeline",
      "Delivery custody timeline payload is malformed.",
    );
  }
  const defaultCurrency = w.delivery?.currency || "NGN";
  return {
    deliveryId: w.deliveryId,
    state: w.state,
    version: w.version,
    delivery: w.delivery
      ? {
          trackingNumber: w.delivery.trackingNumber,
          requestId: w.delivery.requestId,
          pickupAddress: w.delivery.pickupLocation.address,
          dropoffAddress: w.delivery.dropoffLocation.address,
          pickupContact:
            w.delivery.pickupContact &&
            (w.delivery.pickupContact.name || w.delivery.pickupContact.phone)
              ? w.delivery.pickupContact
              : null,
          dropoffContact:
            w.delivery.dropoffContact &&
            (w.delivery.dropoffContact.name || w.delivery.dropoffContact.phone)
              ? w.delivery.dropoffContact
              : null,
          package: w.delivery.package,
          agreedFare: pairMoney(
            w.delivery.agreedFareMinor ?? 0,
            w.delivery.currency || "NGN",
          ),
          currency: w.delivery.currency || "NGN",
        }
      : null,
    openReturn: w.openReturn
      ? {
          returnId: w.openReturn.returnId,
          reason: w.openReturn.reason ?? "",
          proposedByRole: w.openReturn.proposedByRole ?? "",
          chargeStatus: w.openReturn.chargeStatus,
          consentState: w.openReturn.consentState,
          consentExpiresAt: w.openReturn.consentExpiresAt,
          hasFee: w.openReturn.feeMinor > 0,
          fee: pairMoney(
            w.openReturn.feeMinor,
            w.openReturn.currency || defaultCurrency,
          ),
        }
      : null,
    returnPolicy: w.returnPolicy ?? {
      chargedReturnsOffered: false,
      feeFreeOnly: true,
    },
    proofs: w.proofs ?? [],
    events: w.events,
  };
}

const ALLOWED_PROOF_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

export function validateProofCandidate(photo: ProofPhotoCandidate): void {
  if (!ALLOWED_PROOF_TYPES.has(photo.contentType)) {
    throw new ApiError(
      400,
      "PROOF_CONTENT_TYPE_MISMATCH",
      "Proof photo must be a JPEG, PNG, or WebP image.",
    );
  }
  if (
    !Number.isInteger(photo.sizeBytes) ||
    photo.sizeBytes <= 0 ||
    photo.sizeBytes > MAX_PROOF_SIZE_BYTES
  ) {
    throw new ApiError(
      400,
      "PROOF_OBJECT_TOO_LARGE",
      "Proof photo must be between 1 byte and 15 MB.",
    );
  }
  if (!SHA256_HEX_RE.test(photo.sha256.trim())) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Proof photo is missing a valid 64-character SHA-256 digest.",
    );
  }
}

export async function putPresignedProofBytes(
  target: ProofUploadTarget,
  bytes: Uint8Array | ArrayBuffer | string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(target.url, {
      method: target.method || "PUT",
      headers: target.headers,
      body: bytes as unknown as RequestInit["body"],
    });
  } catch {
    throw new ApiError(
      503,
      "PROOF_STORAGE_UNAVAILABLE",
      "Could not upload the proof photo to storage. Check your connection and retry.",
    );
  }
  if (!res.ok) {
    throw new ApiError(
      503,
      "PROOF_STORAGE_UNAVAILABLE",
      "Proof object storage rejected the upload (HTTP " +
        res.status +
        "). Retry shortly.",
    );
  }
}

const custodyBase = (deliveryId: string) =>
  "/v1/delivery/deliveries/" + encodeURIComponent(deliveryId) + "/custody";

export const deliveryApi = {
  custody: (deliveryId: string) =>
    api<unknown>("GET", custodyBase(deliveryId))
      .then((raw) => unwrapDeliveryEnvelope<CustodyTimelineWire>(raw))
      .then(mapDriverCustodyTimeline),

  requestProofUpload: (deliveryId: string, body: ProofUploadDeclaration) =>
    api<unknown>("POST", custodyBase(deliveryId) + "/proof-uploads", {
      type: body.type,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256.trim().toLowerCase(),
    }).then((raw) => unwrapDeliveryEnvelope<ProofUploadIssued>(raw)),

  attachPickupProof: (deliveryId: string, uploadId: string) =>
    api<unknown>("POST", custodyBase(deliveryId) + "/pickup-proof", {
      uploadId,
    }).then((raw) => unwrapDeliveryEnvelope<ProofAttachResult>(raw)),

  attachDeliveryProof: (deliveryId: string, uploadId: string) =>
    api<unknown>("POST", custodyBase(deliveryId) + "/delivery-proof", {
      uploadId,
    }).then((raw) => unwrapDeliveryEnvelope<ProofAttachResult>(raw)),

  completeReturn: (deliveryId: string, uploadId: string) =>
    api<unknown>("POST", custodyBase(deliveryId) + "/return/complete", {
      uploadId,
    }).then((raw) => unwrapDeliveryEnvelope<ProofAttachResult>(raw)),

  uploadAndAttachProof: async (
    deliveryId: string,
    proofType: CustodyProofType,
    photo: ProofPhotoCandidate,
    putFn: typeof putPresignedProofBytes = putPresignedProofBytes,
  ): Promise<ProofAttachResult> => {
    validateProofCandidate(photo);
    const issued = await deliveryApi.requestProofUpload(deliveryId, {
      type: proofType,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      sha256: photo.sha256,
    });
    await putFn(issued.upload, photo.bytes);
    if (proofType === "pickup") {
      return deliveryApi.attachPickupProof(deliveryId, issued.uploadId);
    }
    if (proofType === "delivery") {
      return deliveryApi.attachDeliveryProof(deliveryId, issued.uploadId);
    }
    return deliveryApi.completeReturn(deliveryId, issued.uploadId);
  },

  // Ephemeral presigned GET URL (~60s TTL); never cached across renders or persisted.
  proofDownloadUrl: (deliveryId: string, proofId: string) =>
    api<unknown>(
      "GET",
      custodyBase(deliveryId) +
        "/proofs/" +
        encodeURIComponent(proofId) +
        "/url",
    ).then((raw) => unwrapDeliveryEnvelope<ProofDownloadUrlResult>(raw)),

  reportRecipientUnreachable: (deliveryId: string, reason: string) =>
    api<unknown>("POST", custodyBase(deliveryId) + "/recipient-unreachable", {
      reason,
    }).then((raw) =>
      unwrapDeliveryEnvelope<{ deliveryId: string; custodyState: string }>(raw),
    ),

  proposeReturn: (
    deliveryId: string,
    body: { reason: string; feeMoney?: Money | null },
  ) =>
    api<unknown>(
      "POST",
      custodyBase(deliveryId) + "/return/propose",
      body.feeMoney
        ? {
            reason: body.reason,
            feeMinor: body.feeMoney.amountMinor,
            currency: body.feeMoney.currency,
          }
        : {
            reason: body.reason,
            feeMinor: 0,
          },
    ).then((raw) => unwrapDeliveryEnvelope<ProposeReturnResult>(raw)),

  confirmCollected: (deliveryId: string) =>
    api<unknown>("POST", custodyBase(deliveryId) + "/collected").then((raw) =>
      unwrapDeliveryEnvelope<{ deliveryId: string; custodyState: string }>(raw),
    ),
};

export function describeDeliveryError(err: unknown): {
  title: string;
  body: string;
  shouldRefetch: boolean;
} {
  if (!(err instanceof ApiError)) {
    return {
      title: "Connection lost",
      body: "That didn’t reach the server. Your delivery state is unchanged — reconnect and try again.",
      shouldRefetch: false,
    };
  }
  switch (err.code) {
    case "PROOF_STORAGE_UNAVAILABLE":
    case "PROOF_STORAGE_NOT_CONFIGURED":
      return {
        title: "Proof storage unavailable",
        body: "Proof storage is temporarily unavailable. Nothing was recorded — retry shortly.",
        shouldRefetch: false,
      };
    case "PROOF_UPLOAD_LIMIT":
      return {
        title: "Too many open uploads",
        body: "Too many open proof uploads exist for this delivery. Wait a few minutes for them to expire and try again.",
        shouldRefetch: false,
      };
    case "PROOF_UPLOAD_EXPIRED":
    case "PROOF_UPLOAD_REJECTED":
      return {
        title: "Upload expired",
        body: "That upload expired or was rejected. Capture or select the photo again to request a fresh upload.",
        shouldRefetch: false,
      };
    case "PROOF_OBJECT_MISSING":
      return {
        title: "Photo upload incomplete",
        body: "The photo bytes did not finish uploading before attachment. Retry submitting the proof.",
        shouldRefetch: false,
      };
    case "PROOF_SIZE_MISMATCH":
    case "PROOF_CHECKSUM_MISMATCH":
    case "PROOF_CONTENT_TYPE_MISMATCH":
    case "PROOF_OBJECT_TOO_LARGE":
      return {
        title: "Photo verification failed",
        body: "The uploaded file did not match the declared JPEG, PNG, or WebP image (up to 15 MB). Retake the photo and try again.",
        shouldRefetch: false,
      };
    case "CHARGED_RETURNS_NOT_OFFERED":
      return {
        title: "Charged returns aren’t offered here",
        body: "Propose a fee-free return (₦0 fee), or hand the package off at a partner hold point.",
        shouldRefetch: true,
      };
    case "RETURN_FEE_OUT_OF_BOUNDS":
      return {
        title: "Return fee out of bounds",
        body:
          err.message ||
          "The return fee cannot exceed the delivery’s agreed fare.",
        shouldRefetch: false,
      };
    case "RETURN_FEE_PENDING":
      return {
        title: "Return fee confirmation pending",
        body: "Payment service hasn’t confirmed the fee status yet. Nothing changed — retry shortly.",
        shouldRefetch: true,
      };
    case "STATE_CONFLICT":
      return {
        title: "Delivery state updated",
        body: "This delivery’s custody state changed on the server. We refreshed the timeline for you.",
        shouldRefetch: true,
      };
    default:
      return {
        title: "Couldn’t complete action",
        body:
          err.message || "Please check the delivery timeline and try again.",
        shouldRefetch: err.status === 409,
      };
  }
}
