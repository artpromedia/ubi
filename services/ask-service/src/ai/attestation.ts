/**
 * Serving attestation for the privately served model (recheck A05).
 *
 * A revision string in configuration is not evidence of what a server is
 * running. This module pins the serving identity the assistant was evaluated
 * against and checks it against what the deployed OpenAI-compatible server
 * itself reports, before any model output may drive the tool loop:
 *
 *   - the served model id, which must be listed by `GET {base}/models` (vLLM's
 *     `--served-model-name`, SGLang's `--served-model-name`);
 *   - the weights revision and the tokenizer revision — a 40-hex Hugging Face
 *     commit or a `sha256:` content digest, never a human label like "2507";
 *   - the serving image, pinned by digest (`repo@sha256:…`);
 *   - the tool-call parser configuration (e.g. `vllm:hermes+auto-tool-choice`),
 *     because a parser mismatch silently turns tool calls into plain text.
 *
 * Sources are the model card in `/models` (any of the snake_case keys below that
 * a server or proxy exposes on the entry) and, when configured, an attestation
 * document the serving deployment publishes from its real artifacts (image digest
 * from the pod spec, snapshot commit from the downloaded weights, parser from the
 * launch arguments). vLLM and SGLang do not expose revisions natively, so a
 * production deployment publishes that document — docs/MODEL-SERVING.md.
 *
 * Verdicts are deliberately fail-closed: an unreachable endpoint, a different
 * served model, a reported value that differs from the pin, or an invalid pin is
 * never attested. In `strict` mode (the default) every pin must be configured and
 * confirmed by a server-reported value; `served_model` mode (development) needs
 * only the served id, and still fails on any reported mismatch.
 *
 * This is serving-reported identity checked at runtime. It catches misdeploys and
 * drift (wrong model, wrong image, wrong parser, a silently swapped snapshot); it
 * is not a hardware attestation against a malicious server.
 */
import { createHash } from "node:crypto";

import { isProductionEnvironment } from "../lib/ride-context";

export type AttestationMode = "strict" | "served_model";

export const PIN_FIELDS = [
  "weights_revision",
  "tokenizer_revision",
  "serving_image",
  "tool_parser",
] as const;
export type PinField = (typeof PIN_FIELDS)[number];
export type AttestedField = "served_model_id" | PinField;

export interface ModelServingPin {
  /** Exact id the server must list at `GET /models`; also the request `model`. */
  readonly servedModelId: string;
  readonly weightsRevision: string | null;
  readonly tokenizerRevision: string | null;
  readonly servingImage: string | null;
  readonly toolParser: string | null;
}

export interface ModelServingConfig {
  /** Human-readable revision label (e.g. "2507"). Recorded, never evidence. */
  readonly revisionLabel: string;
  readonly pin: ModelServingPin;
  readonly mode: AttestationMode;
  /** Where the serving deployment publishes its attestation document, if it does. */
  readonly attestationUrl: string | null;
  /** Configuration errors; any entry keeps attestation failing (`pin_invalid`). */
  readonly problems: readonly string[];
}

export type FieldVerdict =
  | "verified"
  | "mismatch"
  | "unverified"
  | "not_pinned"
  | "invalid_pin";

export type AttestationReason =
  | "endpoint_unreachable"
  | "models_listing_invalid"
  | "served_model_mismatch"
  | "attestation_document_unavailable"
  | "metadata_mismatch"
  | "pin_invalid"
  | "pin_incomplete"
  | "metadata_unverified";

export interface ReportedIdentity {
  /** Ids listed by `GET /models` (first 20). */
  readonly servedModelIds: readonly string[];
  /** vLLM/SGLang `root` of the matching entry (the loaded model path), if any. */
  readonly root: string | null;
  readonly fields: Readonly<Record<PinField, string | null>>;
  readonly sources: readonly ("models" | "attestation_document")[];
}

export interface ModelAttestation {
  readonly ok: boolean;
  readonly reason: AttestationReason | null;
  /** Ids and codes only — safe to log and to return on the internal endpoint. */
  readonly detail: string | null;
  readonly mode: AttestationMode;
  readonly checkedAt: string;
  readonly revisionLabel: string;
  readonly expected: ModelServingPin;
  readonly reported: ReportedIdentity;
  readonly fields: Readonly<Record<AttestedField, FieldVerdict>>;
  /** sha256 over the attested identity; null unless `ok`. */
  readonly digest: string | null;
  /**
   * What an ai_actions row records as `model_revision`: the human label plus the
   * attested digest (`2507+att.<16 hex>`, or `+att-partial.` outside strict mode).
   */
  readonly auditRevision: string | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** A Hugging Face / git commit, or a sha256 content digest. */
const REVISION_FORMAT = /^(?:[0-9a-f]{40}|sha256:[0-9a-f]{64})$/i;
/** An OCI image reference pinned by digest. */
const IMAGE_FORMAT = /^[^\s@]+@sha256:[0-9a-f]{64}$/i;
const TOOL_PARSER_FORMAT = /^[A-Za-z0-9_.:;/=+-]{1,128}$/;

type Env = Readonly<Record<string, string | undefined>>;

function optional(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Reads the serving pin from the environment. Never throws: a malformed pin is
 * recorded as a problem that keeps AI execution off, while the rest of the app
 * boots normally.
 */
export function loadModelServingConfig(
  env: Env,
  defaults: { readonly model: string; readonly revision: string },
): ModelServingConfig {
  const problems: string[] = [];
  const modelName = optional(env, "MODEL_NAME") ?? defaults.model;
  const pin: ModelServingPin = {
    servedModelId: optional(env, "MODEL_SERVED_ID") ?? modelName,
    weightsRevision: optional(env, "MODEL_WEIGHTS_REVISION"),
    tokenizerRevision: optional(env, "MODEL_TOKENIZER_REVISION"),
    servingImage: optional(env, "MODEL_SERVING_IMAGE"),
    toolParser: optional(env, "MODEL_TOOL_PARSER"),
  };
  if (
    pin.weightsRevision !== null &&
    !REVISION_FORMAT.test(pin.weightsRevision)
  ) {
    problems.push(
      "MODEL_WEIGHTS_REVISION must be a 40-hex commit or sha256:<64 hex>",
    );
  }
  if (
    pin.tokenizerRevision !== null &&
    !REVISION_FORMAT.test(pin.tokenizerRevision)
  ) {
    problems.push(
      "MODEL_TOKENIZER_REVISION must be a 40-hex commit or sha256:<64 hex>",
    );
  }
  if (pin.servingImage !== null && !IMAGE_FORMAT.test(pin.servingImage)) {
    problems.push(
      "MODEL_SERVING_IMAGE must be pinned by digest (repo@sha256:…)",
    );
  }
  if (pin.toolParser !== null && !TOOL_PARSER_FORMAT.test(pin.toolParser)) {
    problems.push("MODEL_TOOL_PARSER has unsupported characters");
  }

  const rawMode = optional(env, "MODEL_ATTESTATION_MODE");
  let mode: AttestationMode = "strict";
  if (rawMode === "served_model" && isProductionEnvironment(env.NODE_ENV)) {
    // The relaxed mode is for development. In production it never loosens the
    // gate: stay strict and keep AI execution off until the pin is fixed.
    problems.push(
      "MODEL_ATTESTATION_MODE=served_model is development-only; production requires strict",
    );
  } else if (rawMode === "served_model") {
    mode = "served_model";
  } else if (rawMode !== null && rawMode !== "strict") {
    // An unknown mode never loosens anything: stay strict and say so.
    problems.push("MODEL_ATTESTATION_MODE must be strict or served_model");
  }

  const attestationUrl = optional(env, "MODEL_ATTESTATION_URL");
  if (attestationUrl !== null && !/^https?:\/\//.test(attestationUrl)) {
    problems.push("MODEL_ATTESTATION_URL must be an http(s) URL");
  }

  return {
    revisionLabel: optional(env, "MODEL_REVISION") ?? defaults.revision,
    pin,
    mode,
    attestationUrl,
    problems,
  };
}

function pinValue(pin: ModelServingPin, field: PinField): string | null {
  switch (field) {
    case "weights_revision":
      return pin.weightsRevision;
    case "tokenizer_revision":
      return pin.tokenizerRevision;
    case "serving_image":
      return pin.servingImage;
    case "tool_parser":
      return pin.toolParser;
  }
}

function pinFieldValid(pin: ModelServingPin, field: PinField): boolean {
  const value = pinValue(pin, field);
  if (value === null) {
    return true;
  }
  if (field === "serving_image") {
    return IMAGE_FORMAT.test(value);
  }
  if (field === "tool_parser") {
    return TOOL_PARSER_FORMAT.test(value);
  }
  return REVISION_FORMAT.test(value);
}

// ---------------------------------------------------------------------------
// Attestation
// ---------------------------------------------------------------------------

export interface AttestInput {
  readonly baseUrl: string;
  readonly config: ModelServingConfig;
  readonly fetchImpl: typeof fetch;
  /** Headers for the model endpoint (the bearer token, when configured). */
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly now: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportedString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

type FetchOutcome =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly detail: string };

async function getJson(
  input: AttestInput,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);
  try {
    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", ...headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, detail: `http_${response.status}` };
    }
    try {
      return { ok: true, payload: await response.json() };
    } catch {
      return { ok: false, detail: "invalid_json" };
    }
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function emptyFields(): Record<PinField, string | null> {
  return {
    weights_revision: null,
    tokenizer_revision: null,
    serving_image: null,
    tool_parser: null,
  };
}

function failed(
  input: AttestInput,
  reason: AttestationReason,
  detail: string | null,
  reported: ReportedIdentity,
  fields: Record<AttestedField, FieldVerdict>,
): ModelAttestation {
  return {
    ok: false,
    reason,
    detail,
    mode: input.config.mode,
    checkedAt: input.now().toISOString(),
    revisionLabel: input.config.revisionLabel,
    expected: input.config.pin,
    reported,
    fields,
    digest: null,
    auditRevision: null,
  };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Checks the deployed server against the pin. Never throws; every failure is an
 * unattested result with an explicit reason.
 */
export async function attestServing(
  input: AttestInput,
): Promise<ModelAttestation> {
  const { config } = input;
  const pin = config.pin;
  const fields: Record<AttestedField, FieldVerdict> = {
    served_model_id: "unverified",
    weights_revision: "unverified",
    tokenizer_revision: "unverified",
    serving_image: "unverified",
    tool_parser: "unverified",
  };
  const noReport: ReportedIdentity = {
    servedModelIds: [],
    root: null,
    fields: emptyFields(),
    sources: [],
  };

  const modelsUrl = `${input.baseUrl.replace(/\/+$/, "")}/models`;
  const listing = await getJson(input, modelsUrl, input.headers);
  if (!listing.ok) {
    return failed(
      input,
      "endpoint_unreachable",
      listing.detail,
      noReport,
      fields,
    );
  }
  const data =
    isRecord(listing.payload) && Array.isArray(listing.payload.data)
      ? listing.payload.data.filter(isRecord)
      : null;
  if (data === null) {
    return failed(
      input,
      "models_listing_invalid",
      "no data array",
      noReport,
      fields,
    );
  }
  const servedModelIds = data
    .map((entry) => reportedString(entry, "id"))
    .filter((id): id is string => id !== null)
    .slice(0, 20);
  const entry = data.find((candidate) => candidate.id === pin.servedModelId);
  if (entry === undefined) {
    fields.served_model_id = "mismatch";
    return failed(
      input,
      "served_model_mismatch",
      `served: ${servedModelIds.join(",") || "none"}`,
      { ...noReport, servedModelIds },
      fields,
    );
  }
  fields.served_model_id = "verified";

  // Every source that reports a field; each reported value must equal the pin.
  const reportedValues: Record<PinField, string[]> = {
    weights_revision: [],
    tokenizer_revision: [],
    serving_image: [],
    tool_parser: [],
  };
  const sources: ("models" | "attestation_document")[] = ["models"];
  for (const field of PIN_FIELDS) {
    const value = reportedString(entry, field);
    if (value !== null) {
      reportedValues[field].push(value);
    }
  }

  if (config.attestationUrl !== null) {
    // The bearer token only ever goes back to the model endpoint's own origin.
    const document = await getJson(
      input,
      config.attestationUrl,
      sameOrigin(config.attestationUrl, input.baseUrl) ? input.headers : {},
    );
    const reportedSoFar: ReportedIdentity = {
      servedModelIds,
      root: reportedString(entry, "root"),
      fields: emptyFields(),
      sources,
    };
    if (!document.ok || !isRecord(document.payload)) {
      return failed(
        input,
        "attestation_document_unavailable",
        document.ok ? "not an object" : document.detail,
        reportedSoFar,
        fields,
      );
    }
    sources.push("attestation_document");
    const documentServedId = reportedString(
      document.payload,
      "served_model_id",
    );
    if (documentServedId !== null && documentServedId !== pin.servedModelId) {
      fields.served_model_id = "mismatch";
      return failed(
        input,
        "served_model_mismatch",
        `attestation document serves ${documentServedId}`,
        reportedSoFar,
        fields,
      );
    }
    for (const field of PIN_FIELDS) {
      const value = reportedString(document.payload, field);
      if (value !== null) {
        reportedValues[field].push(value);
      }
    }
  }

  const reportedFields = emptyFields();
  for (const field of PIN_FIELDS) {
    const values = reportedValues[field];
    reportedFields[field] = values[0] ?? null;
    const pinned = pinValue(pin, field);
    if (!pinFieldValid(pin, field)) {
      fields[field] = "invalid_pin";
    } else if (pinned === null) {
      fields[field] = "not_pinned";
    } else if (values.length === 0) {
      fields[field] = "unverified";
    } else if (
      values.every((value) => normalize(value) === normalize(pinned))
    ) {
      fields[field] = "verified";
    } else {
      fields[field] = "mismatch";
    }
  }
  const reported: ReportedIdentity = {
    servedModelIds,
    root: reportedString(entry, "root"),
    fields: reportedFields,
    sources,
  };

  const verdicts = PIN_FIELDS.map((field) => fields[field]);
  const listOf = (verdict: FieldVerdict): string =>
    PIN_FIELDS.filter((field) => fields[field] === verdict).join(",");
  if (verdicts.includes("mismatch")) {
    return failed(
      input,
      "metadata_mismatch",
      listOf("mismatch"),
      reported,
      fields,
    );
  }
  if (config.problems.length > 0 || verdicts.includes("invalid_pin")) {
    return failed(
      input,
      "pin_invalid",
      config.problems.join("; ") || listOf("invalid_pin"),
      reported,
      fields,
    );
  }
  if (config.mode === "strict") {
    if (verdicts.includes("not_pinned")) {
      return failed(
        input,
        "pin_incomplete",
        listOf("not_pinned"),
        reported,
        fields,
      );
    }
    if (verdicts.includes("unverified")) {
      return failed(
        input,
        "metadata_unverified",
        listOf("unverified"),
        reported,
        fields,
      );
    }
  }

  // The digest covers exactly what was attested: the served id plus each pin a
  // server-reported value confirmed (null where nothing confirmed it).
  const attested: Record<string, string | null> = {
    served_model_id: pin.servedModelId,
    mode: config.mode,
  };
  for (const field of PIN_FIELDS) {
    attested[field] =
      fields[field] === "verified"
        ? normalize(pinValue(pin, field) ?? "")
        : null;
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(attested))
    .digest("hex");
  const marker = config.mode === "strict" ? "att" : "att-partial";
  return {
    ok: true,
    reason: null,
    detail: null,
    mode: config.mode,
    checkedAt: input.now().toISOString(),
    revisionLabel: config.revisionLabel,
    expected: pin,
    reported,
    fields,
    digest: `sha256:${digest}`,
    auditRevision: `${config.revisionLabel}+${marker}.${digest.slice(0, 16)}`,
  };
}
