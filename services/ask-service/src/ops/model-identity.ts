/**
 * The model identity an ops-written ai_actions row records.
 *
 * The message loop records the identity that served each round (the provider
 * returns it on every attested response). Rows written by the OPS — review
 * confirmations, executions, marketplace actions — are not produced by a model
 * round, so they record the identity the provider last ATTESTED
 * (`deps.model.lastAttestation()`, ai/attestation.ts): the served model id and
 * the audit revision that carries the attested digest. The configured name and
 * human-readable revision label are not evidence of what is serving (recheck
 * A05), so they are never written as if they were:
 *
 *   - an attesting provider with a successful attestation → the attested
 *     served id + `auditRevision` (`<label>+att.<digest>`);
 *   - an attesting provider with no successful attestation yet (never attested,
 *     or the last check failed) → the configured label, explicitly suffixed
 *     `+unattested`, so the row can never be mistaken for serving evidence;
 *   - an in-process provider with no serving endpoint to attest (tests, local
 *     development) → its own name and label, which are all it has.
 */
import type { ModelProvider } from "../ai/model-provider";

export interface AuditModelIdentity {
  readonly model: string;
  readonly modelRevision: string;
}

export const UNATTESTED_SUFFIX = "+unattested";

export function auditModelIdentity(model: ModelProvider): AuditModelIdentity {
  if (model.lastAttestation === undefined) {
    return { model: model.model, modelRevision: model.revision };
  }
  const attestation = model.lastAttestation();
  if (
    attestation !== null &&
    attestation.ok &&
    attestation.auditRevision !== null
  ) {
    return {
      model: attestation.expected.servedModelId,
      modelRevision: attestation.auditRevision,
    };
  }
  return {
    model: model.model,
    modelRevision: `${model.revision}${UNATTESTED_SUFFIX}`,
  };
}
