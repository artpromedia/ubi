/**
 * ai_actions rows written by the OPS (reviews, executions, marketplace) record
 * the ATTESTED serving identity — the served model id and the audit revision
 * carrying the attested digest (`deps.model.lastAttestation()`) — not the
 * configured name and human-readable label (recheck A05, round-3 follow-up).
 *
 * The provider is the real HTTP provider against the OpenAI-compatible stub
 * serving a matching attestation document; the rows are the real rows a
 * marketplace review, its confirm, the grant, the selection intent, the award
 * and the execution write.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  UNATTESTED_SUFFIX,
  auditModelIdentity,
} from "../src/ops/model-identity";
import { createMarketplaceReview } from "../src/ops/mp-lifecycle";
import { confirmReview } from "../src/ops/reviews";
import { openThread } from "../src/ops/threads";
import {
  closeTestDb,
  DeterministicModelProvider,
  FakeMarketplacePort,
  makeDeps,
  mpOffer,
  mpRequest,
  rider,
  seedCity,
  testDb,
  uid,
} from "./helpers";
import {
  matchingAttestation,
  startOpenAiStub,
  stubProvider,
  type OpenAiStub,
} from "./openai-stub";

import type { ModelProvider } from "../src/ai/model-provider";
import type { Actor } from "../src/ops/types";

let stub: OpenAiStub;
let cityId: string;
let actor: Actor;

beforeAll(async () => {
  stub = await startOpenAiStub({ attestation: matchingAttestation() });
});

afterAll(async () => {
  await stub.close();
  await closeTestDb();
});

beforeEach(async () => {
  cityId = await seedCity(testDb(), { aiMarketplace: true });
  actor = rider();
});

async function selectThroughAsk(model: ModelProvider): Promise<string[]> {
  const marketplace = new FakeMarketplacePort();
  const request = mpRequest({ requesterId: actor.id, cityId, revision: 1 });
  const bidId = uid("bid");
  marketplace.seedRequest(request);
  marketplace.setOffers(request.requestId, [
    mpOffer({ bidId, requestRevision: 1 }),
  ]);
  const deps = makeDeps(testDb(), { marketplace, model });
  const thread = await openThread(deps, {
    actor,
    cityId,
    source: "home",
    correlationId: null,
  });
  const review = await createMarketplaceReview(deps, {
    actor,
    cityId,
    threadId: thread.id,
    request: { stage: "select", requestId: request.requestId, bidId },
    idempotencyKey: uid("rv"),
    correlationId: null,
  });
  await confirmReview(deps, {
    actor,
    cityId,
    reviewId: review.id,
    termsVersion: review.termsVersion,
    assurance: { method: "pin", proof: "p" },
    idempotencyKey: uid("cf"),
    correlationId: null,
  });
  expect(marketplace.awardsCreated).toBe(1);
  return [review.id];
}

async function opsRows() {
  return testDb().aiAction.findMany({
    where: {
      actorRef: actor.id,
      action: {
        in: [
          "mp.review.proposed",
          "review.confirm",
          "mp.authorize",
          "mp.select.intent",
          "mp.select",
          "execution.run",
        ],
      },
    },
  });
}

describe("ops rows record the attested serving identity", () => {
  it("records the served model id and the attested audit revision", async () => {
    const provider = stubProvider(stub);
    const attestation = await provider.attest?.();
    expect(attestation?.ok).toBe(true);

    await selectThroughAsk(provider);

    const rows = await opsRows();
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set([
        "mp.review.proposed",
        "review.confirm",
        "mp.authorize",
        "mp.select.intent",
        "mp.select",
        "execution.run",
      ]),
    );
    for (const row of rows) {
      expect(row.model).toBe(attestation?.expected.servedModelId);
      expect(row.modelRevision).toBe(attestation?.auditRevision);
      expect(row.modelRevision).toMatch(/^2507\+att\.[0-9a-f]{16}$/);
    }
  });

  it("marks the configured label unattested when the provider has not attested", async () => {
    const provider = stubProvider(stub);
    expect(provider.lastAttestation?.()).toBeNull();
    await selectThroughAsk(provider);
    for (const row of await opsRows()) {
      expect(row.modelRevision).toBe(`2507${UNATTESTED_SUFFIX}`);
    }
  });

  it("records an in-process provider's own name and label (nothing to attest)", () => {
    const provider = new DeterministicModelProvider();
    expect(auditModelIdentity(provider)).toEqual({
      model: provider.model,
      modelRevision: provider.revision,
    });
  });

  it("drops back to unattested when the last attestation failed", async () => {
    const failing = await startOpenAiStub({
      attestation: matchingAttestation({ serving_image: "sha256:other" }),
    });
    try {
      const provider = stubProvider(failing);
      const attestation = await provider.attest?.();
      expect(attestation?.ok).toBe(false);
      expect(auditModelIdentity(provider).modelRevision).toBe(
        `2507${UNATTESTED_SUFFIX}`,
      );
    } finally {
      await failing.close();
    }
  });
});
