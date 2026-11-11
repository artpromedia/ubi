/**
 * Private S3-compatible document storage port for fleet KYB and vehicle
 * documents (CC-C02 / P1-05).
 *
 * Mirrors delivery-service's `internal/proofstore` architecture:
 *  - Bucket is private; objects are never exposed via public URLs.
 *  - `presignPut` signs a short-lived PUT URL for a server-minted object key
 *    with `Content-Type` and `X-Amz-Checksum-Sha256` (base64 of the declared
 *    SHA-256 digest) bound into the signature.
 *  - On KYB submit or vehicle document attach, `verifyStoredObject` reads the
 *    uploaded object from the private bucket and verifies:
 *      1. exact byte length matches `sizeBytes`;
 *      2. SHA-256 of the stored bytes matches `sha256Hex`;
 *      3. magic bytes match the declared `contentType` (`application/pdf`,
 *         `image/jpeg`, `image/png`, `image/webp`).
 *    On any mismatch the stored object is deleted and the call fails with
 *    `422 upload_verification_failed`.
 *  - `presignGet` mints a short-lived private GET URL (`response-cache-control:
 *    private, no-store`) only after the caller's entitlement is verified.
 */
import { createHash, createHmac } from "node:crypto";

import {
  ContractError,
  FLEET_DOCUMENT_MAX_BYTES,
  type FleetDocumentContentType,
} from "@ubi/contracts";

export const CHECKSUM_HEADER = "X-Amz-Checksum-Sha256";
export const UPLOAD_TTL_SEC = 900; // 15 minutes
export const DOWNLOAD_TTL_SEC = 300; // 5 minutes

export interface StoredObjectStat {
  readonly sizeBytes: number;
  readonly contentType: string;
}

export interface PresignedPut {
  readonly url: string;
  readonly requiredHeaders: Record<string, string>;
  readonly expiresAt: Date;
}

export interface PresignedGet {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface DocStore {
  configured(): boolean;
  presignPut(input: {
    readonly objectKey: string;
    readonly contentType: FleetDocumentContentType;
    readonly sha256Hex: string;
    readonly ttlSec?: number;
  }): Promise<PresignedPut>;
  presignGet(input: {
    readonly objectKey: string;
    readonly ttlSec?: number;
  }): Promise<PresignedGet>;
  stat(objectKey: string): Promise<StoredObjectStat>;
  readBytes(objectKey: string, maxBytes?: number): Promise<Buffer>;
  remove(objectKey: string): Promise<void>;
}

export function sha256HexToBase64(sha256Hex: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(sha256Hex)) {
    throw new ContractError(
      "validation_failed",
      "sha256Hex must be a 64-character hex digest",
    );
  }
  return Buffer.from(sha256Hex, "hex").toString("base64");
}

/**
 * Magic-byte content-type sniffer for the four allowed document formats:
 * PDF (`%PDF-`), JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), and
 * WebP (`RIFF....WEBP`).
 */
export function sniffDocumentContentType(
  bytes: Buffer,
): FleetDocumentContentType | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function verifyStoredObject(
  store: DocStore,
  spec: {
    readonly objectKey: string;
    readonly expectedContentType: FleetDocumentContentType;
    readonly expectedSizeBytes: number;
    readonly expectedSha256Hex: string;
  },
): Promise<void> {
  if (!store.configured()) {
    throw new ContractError(
      "doc_storage_not_configured",
      "Document storage is not configured in this environment",
    );
  }
  let stat: StoredObjectStat;
  try {
    stat = await store.stat(spec.objectKey);
  } catch (error) {
    if (error instanceof ContractError) {
      throw error;
    }
    throw new ContractError(
      "upload_verification_failed",
      "Uploaded document was not found in storage",
      { reason: "object_not_found", objectKey: spec.objectKey },
    );
  }
  if (stat.sizeBytes !== spec.expectedSizeBytes) {
    await store.remove(spec.objectKey).catch(() => undefined);
    throw new ContractError(
      "upload_verification_failed",
      "Uploaded document size does not match the declared size",
      {
        reason: "size_mismatch",
        declaredSizeBytes: spec.expectedSizeBytes,
        actualSizeBytes: stat.sizeBytes,
      },
    );
  }
  const bytes = await store.readBytes(spec.objectKey, FLEET_DOCUMENT_MAX_BYTES);
  if (bytes.length !== spec.expectedSizeBytes) {
    await store.remove(spec.objectKey).catch(() => undefined);
    throw new ContractError(
      "upload_verification_failed",
      "Uploaded document size does not match the declared size",
      {
        reason: "size_mismatch",
        declaredSizeBytes: spec.expectedSizeBytes,
        actualSizeBytes: bytes.length,
      },
    );
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== spec.expectedSha256Hex.toLowerCase()) {
    await store.remove(spec.objectKey).catch(() => undefined);
    throw new ContractError(
      "upload_verification_failed",
      "Uploaded document SHA-256 checksum does not match the declared digest",
      {
        reason: "checksum_mismatch",
        declaredSha256Hex: spec.expectedSha256Hex.toLowerCase(),
        actualSha256Hex: actualSha256,
      },
    );
  }
  const sniffed = sniffDocumentContentType(bytes);
  if (sniffed !== spec.expectedContentType) {
    await store.remove(spec.objectKey).catch(() => undefined);
    throw new ContractError(
      "upload_verification_failed",
      "Uploaded document bytes do not match the declared content type",
      {
        reason: "content_type_mismatch",
        declaredContentType: spec.expectedContentType,
        sniffedContentType: sniffed,
      },
    );
  }
}

export function createUnconfiguredDocStore(): DocStore {
  const refuse = (): never => {
    throw new ContractError(
      "doc_storage_not_configured",
      "Document storage is not configured in this environment",
    );
  };
  return {
    configured: () => false,
    presignPut: async () => refuse(),
    presignGet: async () => refuse(),
    stat: async () => refuse(),
    readBytes: async () => refuse(),
    remove: async () => refuse(),
  };
}

export interface S3DocStoreConfig {
  readonly endpoint: string;
  readonly publicEndpoint?: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly now?: () => Date;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function amzTimestamps(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(bucket: string, objectKey: string): string {
  const segments = [bucket, ...objectKey.split("/").filter(Boolean)];
  return `/${segments.map(encodeRfc3986).join("/")}`;
}

function signingKey(
  secretKey: string,
  dateStamp: string,
  region: string,
): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function presignS3Url(params: {
  readonly baseUrl: string;
  readonly method: "PUT" | "GET";
  readonly bucket: string;
  readonly objectKey: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly now: Date;
  readonly ttlSec: number;
  readonly signedHeaders: Readonly<Record<string, string>>;
  readonly extraQuery?: Readonly<Record<string, string>>;
}): string {
  const parsed = new URL(params.baseUrl);
  const uri = canonicalUri(params.bucket, params.objectKey);
  const { amzDate, dateStamp } = amzTimestamps(params.now);
  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;

  const headerEntries = Object.entries({
    host: parsed.host,
    ...Object.fromEntries(
      Object.entries(params.signedHeaders).map(([k, v]) => [
        k.toLowerCase(),
        v.trim(),
      ]),
    ),
  }).sort(([a], [b]) => a.localeCompare(b));

  const signedHeadersList = headerEntries.map(([k]) => k).join(";");
  const canonicalHeaders = headerEntries
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${params.accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(params.ttlSec),
    "X-Amz-SignedHeaders": signedHeadersList,
    ...(params.extraQuery ?? {}),
  };

  const canonicalQuery = Object.entries(queryParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join("&");

  const canonicalRequest = [
    params.method,
    uri,
    canonicalQuery,
    canonicalHeaders,
    signedHeadersList,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac(
    "sha256",
    signingKey(params.secretKey, dateStamp, params.region),
  )
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${parsed.origin}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createS3DocStore(cfg: S3DocStoreConfig): DocStore {
  const nowFn = cfg.now ?? (() => new Date());
  const publicBase =
    cfg.publicEndpoint && cfg.publicEndpoint.trim().length > 0
      ? cfg.publicEndpoint
      : cfg.endpoint;

  async function signedInternalFetch(
    method: "HEAD" | "GET" | "DELETE",
    objectKey: string,
  ): Promise<Response> {
    const parsed = new URL(cfg.endpoint);
    const uri = canonicalUri(cfg.bucket, objectKey);
    const now = nowFn();
    const { amzDate, dateStamp } = amzTimestamps(now);
    const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
    const payloadHash = sha256Hex("");
    const canonicalHeaders = `host:${parsed.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      method,
      uri,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = createHmac(
      "sha256",
      signingKey(cfg.secretKey, dateStamp, cfg.region),
    )
      .update(stringToSign, "utf8")
      .digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    try {
      return await fetch(`${parsed.origin}${uri}`, {
        method,
        headers: {
          "x-amz-date": amzDate,
          "x-amz-content-sha256": payloadHash,
          Authorization: authorization,
        },
      });
    } catch (error) {
      throw new ContractError(
        "doc_storage_unavailable",
        "Document storage could not be reached",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  return {
    configured: () => true,
    async presignPut({
      objectKey,
      contentType,
      sha256Hex: digestHex,
      ttlSec = UPLOAD_TTL_SEC,
    }) {
      const checksumBase64 = sha256HexToBase64(digestHex);
      const now = nowFn();
      const requiredHeaders = {
        "Content-Type": contentType,
        [CHECKSUM_HEADER]: checksumBase64,
      };
      const url = presignS3Url({
        baseUrl: publicBase,
        method: "PUT",
        bucket: cfg.bucket,
        objectKey,
        region: cfg.region,
        accessKey: cfg.accessKey,
        secretKey: cfg.secretKey,
        now,
        ttlSec,
        signedHeaders: requiredHeaders,
      });
      return {
        url,
        requiredHeaders,
        expiresAt: new Date(now.getTime() + ttlSec * 1000),
      };
    },
    async presignGet({ objectKey, ttlSec = DOWNLOAD_TTL_SEC }) {
      const now = nowFn();
      const url = presignS3Url({
        baseUrl: publicBase,
        method: "GET",
        bucket: cfg.bucket,
        objectKey,
        region: cfg.region,
        accessKey: cfg.accessKey,
        secretKey: cfg.secretKey,
        now,
        ttlSec,
        signedHeaders: {},
        extraQuery: {
          "response-cache-control": "private, no-store",
        },
      });
      return {
        url,
        expiresAt: new Date(now.getTime() + ttlSec * 1000),
      };
    },
    async stat(objectKey) {
      const res = await signedInternalFetch("HEAD", objectKey);
      if (res.status === 404) {
        throw new ContractError(
          "upload_verification_failed",
          "Uploaded document was not found in storage",
          { reason: "object_not_found", objectKey },
        );
      }
      if (!res.ok) {
        throw new ContractError(
          "doc_storage_unavailable",
          `Document storage HEAD failed with status ${res.status}`,
        );
      }
      const sizeBytes = Number.parseInt(
        res.headers.get("content-length") ?? "0",
        10,
      );
      const contentType =
        res.headers.get("content-type") ?? "application/octet-stream";
      return { sizeBytes, contentType };
    },
    async readBytes(objectKey, maxBytes = FLEET_DOCUMENT_MAX_BYTES) {
      const res = await signedInternalFetch("GET", objectKey);
      if (res.status === 404) {
        throw new ContractError(
          "upload_verification_failed",
          "Uploaded document was not found in storage",
          { reason: "object_not_found", objectKey },
        );
      }
      if (!res.ok) {
        throw new ContractError(
          "doc_storage_unavailable",
          `Document storage GET failed with status ${res.status}`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) {
        throw new ContractError(
          "upload_verification_failed",
          "Uploaded document exceeds the maximum allowed size",
          { reason: "size_exceeded", maxBytes },
        );
      }
      return buf;
    },
    async remove(objectKey) {
      const res = await signedInternalFetch("DELETE", objectKey);
      if (!res.ok && res.status !== 404 && res.status !== 204) {
        throw new ContractError(
          "doc_storage_unavailable",
          `Document storage DELETE failed with status ${res.status}`,
        );
      }
    },
  };
}

export interface MemoryDocStore extends DocStore {
  putObject(objectKey: string, bytes: Buffer, contentType?: string): void;
  hasObject(objectKey: string): boolean;
  clear(): void;
}

export function createMemoryDocStore(
  now: () => Date = () => new Date(),
): MemoryDocStore {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  return {
    configured: () => true,
    putObject(objectKey, bytes, contentType = "application/pdf") {
      objects.set(objectKey, { bytes: Buffer.from(bytes), contentType });
    },
    hasObject(objectKey) {
      return objects.has(objectKey);
    },
    clear() {
      objects.clear();
    },
    async presignPut({
      objectKey,
      contentType,
      sha256Hex: digestHex,
      ttlSec = UPLOAD_TTL_SEC,
    }) {
      const checksumBase64 = sha256HexToBase64(digestHex);
      const issuedAt = now();
      const requiredHeaders = {
        "Content-Type": contentType,
        [CHECKSUM_HEADER]: checksumBase64,
      };
      const url = presignS3Url({
        baseUrl: "https://fleet-docs.internal.ubi.test",
        method: "PUT",
        bucket: "ubi-fleet-documents",
        objectKey,
        region: "eu-central-1",
        accessKey: "memory-access-key",
        secretKey: "memory-secret-key",
        now: issuedAt,
        ttlSec,
        signedHeaders: requiredHeaders,
      });
      return {
        url,
        requiredHeaders,
        expiresAt: new Date(issuedAt.getTime() + ttlSec * 1000),
      };
    },
    async presignGet({ objectKey, ttlSec = DOWNLOAD_TTL_SEC }) {
      const issuedAt = now();
      const url = presignS3Url({
        baseUrl: "https://fleet-docs.internal.ubi.test",
        method: "GET",
        bucket: "ubi-fleet-documents",
        objectKey,
        region: "eu-central-1",
        accessKey: "memory-access-key",
        secretKey: "memory-secret-key",
        now: issuedAt,
        ttlSec,
        signedHeaders: {},
        extraQuery: {
          "response-cache-control": "private, no-store",
        },
      });
      return {
        url,
        expiresAt: new Date(issuedAt.getTime() + ttlSec * 1000),
      };
    },
    async stat(objectKey) {
      const entry = objects.get(objectKey);
      if (entry === undefined) {
        throw new ContractError(
          "upload_verification_failed",
          "Uploaded document was not found in storage",
          { reason: "object_not_found", objectKey },
        );
      }
      return {
        sizeBytes: entry.bytes.length,
        contentType: entry.contentType,
      };
    },
    async readBytes(objectKey, maxBytes = FLEET_DOCUMENT_MAX_BYTES) {
      const entry = objects.get(objectKey);
      if (entry === undefined) {
        throw new ContractError(
          "upload_verification_failed",
          "Uploaded document was not found in storage",
          { reason: "object_not_found", objectKey },
        );
      }
      if (entry.bytes.length > maxBytes) {
        throw new ContractError(
          "upload_verification_failed",
          "Uploaded document exceeds the maximum allowed size",
          { reason: "size_exceeded", maxBytes },
        );
      }
      return Buffer.from(entry.bytes);
    },
    async remove(objectKey) {
      objects.delete(objectKey);
    },
  };
}

export function createDocStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): DocStore {
  const endpoint = env.FLEET_DOC_S3_ENDPOINT?.trim() ?? "";
  const publicEndpoint = env.FLEET_DOC_S3_PUBLIC_ENDPOINT?.trim() ?? "";
  const bucket = env.FLEET_DOC_S3_BUCKET?.trim() ?? "";
  const region = env.FLEET_DOC_S3_REGION?.trim() || "us-east-1";
  const accessKey = env.FLEET_DOC_S3_ACCESS_KEY?.trim() ?? "";
  const secretKey = env.FLEET_DOC_S3_SECRET_KEY?.trim() ?? "";

  const anySet =
    endpoint.length > 0 ||
    publicEndpoint.length > 0 ||
    bucket.length > 0 ||
    accessKey.length > 0 ||
    secretKey.length > 0;
  if (!anySet) {
    return createUnconfiguredDocStore();
  }
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error(
      "fleet document storage is partially configured: FLEET_DOC_S3_ENDPOINT, FLEET_DOC_S3_BUCKET, FLEET_DOC_S3_ACCESS_KEY, and FLEET_DOC_S3_SECRET_KEY are all required when any is set",
    );
  }
  return createS3DocStore({
    endpoint,
    publicEndpoint: publicEndpoint || endpoint,
    bucket,
    region,
    accessKey,
    secretKey,
    now,
  });
}
