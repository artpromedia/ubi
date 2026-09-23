/**
 * Serving attestation and AI readiness (recheck A05).
 *
 * The configured model name and revision label are not evidence. These tests
 * run the real attestation and the real HTTP provider against a local server
 * standing in for vLLM (tests/openai-stub.ts) and prove:
 *
 *   - the pin is read from configuration with the serving artifacts (served id,
 *     weights/tokenizer revision, image digest, tool parser) distinct from the
 *     human label, and a malformed pin never loosens anything;
 *   - AI execution is attested only when the endpoint is reachable, `/models`
 *     lists the pinned served id, and every server-reported revision matches the
 *     pin (strict mode: every pin confirmed);
 *   - no completion is ever requested from an unattested server;
 *   - `/health/ready` keeps the app ready with AI execution off (explicit
 *     reason) while the model is down; `/health/ready/ai` is internal-only and
 *     reports the full attestation;
 *   - regular flows keep working while the model is down.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  attestServing,
  loadModelServingConfig,
  type ModelServingConfig,
} from "../src/ai/attestation";
import { createHttpModelProvider } from "../src/ai/model-provider";
import { createApp } from "../src/index";
import { closeTestDb, makeDeps, rider, seedCity, testDb } from "./helpers";
import {
  completion,
  matchingAttestation,
  pinnedServing,
  SERVED_MODEL,
  SERVING_IMAGE,
  startOpenAiStub,
  stubProvider,
  TOOL_PARSER,
  WEIGHTS_REVISION,
  type OpenAiStub,
} from "./openai-stub";

const stubs: OpenAiStub[] = [];
async function stubWith(
  ...args: Parameters<typeof startOpenAiStub>
): Promise<OpenAiStub> {
  const stub = await startOpenAiStub(...args);
  stubs.push(stub);
  return stub;
}

/** A base URL nothing listens on. */
async function deadBaseUrl(): Promise<string> {
  const stub = await startOpenAiStub();
  const url = stub.baseUrl;
  await stub.close();
  return url;
}

async function attest(stub: { baseUrl: string }, config: ModelServingConfig) {
  return attestServing({
    baseUrl: stub.baseUrl,
    config,
    fetchImpl: fetch,
    headers: {},
    timeoutMs: 2_000,
    now: () => new Date(),
  });
}

const previousKey = process.env.INTERNAL_SERVICE_KEY;

beforeAll(() => {
  process.env.INTERNAL_SERVICE_KEY = "attestation-test-key";
});

afterEach(async () => {
  await Promise.all(stubs.splice(0).map(async (stub) => stub.close()));
});

afterAll(async () => {
  if (previousKey === undefined) {
    delete process.env.INTERNAL_SERVICE_KEY;
  } else {
    process.env.INTERNAL_SERVICE_KEY = previousKey;
  }
  await closeTestDb();
});

describe("serving pin configuration", () => {
  it("defaults to the configured model, strict mode and nothing else pinned", () => {
    const config = loadModelServingConfig(
      {},
      { model: SERVED_MODEL, revision: "2507" },
    );
    expect(config).toEqual({
      revisionLabel: "2507",
      pin: {
        servedModelId: SERVED_MODEL,
        weightsRevision: null,
        tokenizerRevision: null,
        servingImage: null,
        toolParser: null,
      },
      mode: "strict",
      attestationUrl: null,
      problems: [],
    });
  });

  it("rejects a label posing as a revision, an undigested image and an unknown mode", () => {
    const config = loadModelServingConfig(
      {
        MODEL_WEIGHTS_REVISION: "2507",
        MODEL_TOKENIZER_REVISION: "main",
        MODEL_SERVING_IMAGE: "vllm/vllm-openai:latest",
        MODEL_ATTESTATION_MODE: "off",
      },
      { model: SERVED_MODEL, revision: "2507" },
    );
    expect(config.mode).toBe("strict");
    expect(config.problems).toHaveLength(4);
  });

  it("never lets the development-only served_model mode loosen production", async () => {
    for (const nodeEnv of ["production", "prod"]) {
      const config = loadModelServingConfig(
        { NODE_ENV: nodeEnv, MODEL_ATTESTATION_MODE: "served_model" },
        { model: SERVED_MODEL, revision: "2507" },
      );
      expect(config.mode).toBe("strict");
      expect(config.problems).toEqual([
        expect.stringContaining("development-only") as unknown,
      ]);
    }
    // Against a server that lists the served id, production stays unattested.
    const stub = await stubWith();
    const result = await attest(
      stub,
      loadModelServingConfig(
        { NODE_ENV: "production", MODEL_ATTESTATION_MODE: "served_model" },
        { model: SERVED_MODEL, revision: "2507" },
      ),
    );
    expect(result).toMatchObject({ ok: false, reason: "pin_invalid" });
  });
});

describe("attestation against the served endpoint", () => {
  it("attests a fully pinned server and records a stable digest", async () => {
    const stub = await stubWith({ attestation: matchingAttestation() });
    const first = await attest(stub, pinnedServing(stub));
    expect(first.ok).toBe(true);
    expect(first.reason).toBeNull();
    expect(first.fields).toEqual({
      served_model_id: "verified",
      weights_revision: "verified",
      tokenizer_revision: "verified",
      serving_image: "verified",
      tool_parser: "verified",
    });
    expect(first.reported.sources).toEqual(["models", "attestation_document"]);
    expect(first.reported.root).toBe(`/models/${SERVED_MODEL}`);
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.auditRevision).toMatch(/^2507\+att\.[0-9a-f]{16}$/);

    // Same identity, same digest; any pinned artifact changes it.
    const again = await attest(stub, pinnedServing(stub));
    expect(again.digest).toBe(first.digest);
    const otherImage = `vllm/vllm-openai@sha256:${"cd".repeat(32)}`;
    stub.setOptions({
      attestation: matchingAttestation({ serving_image: otherImage }),
    });
    const moved = await attest(
      stub,
      pinnedServing(stub, { MODEL_SERVING_IMAGE: otherImage }),
    );
    expect(moved.ok).toBe(true);
    expect(moved.digest).not.toBe(first.digest);
  });

  it("is not attested when the endpoint is unreachable or broken", async () => {
    const dead = await deadBaseUrl();
    const unreachable = await attest(
      { baseUrl: dead },
      pinnedServing({ attestationUrl: `${dead}/attestation.json` }),
    );
    expect(unreachable).toMatchObject({
      ok: false,
      reason: "endpoint_unreachable",
      detail: "network_error",
      digest: null,
      auditRevision: null,
    });

    const failing = await stubWith({ models: { status: 502, text: "<html>" } });
    expect(await attest(failing, pinnedServing(failing))).toMatchObject({
      ok: false,
      reason: "endpoint_unreachable",
      detail: "http_502",
    });

    const invalid = await stubWith({ models: { json: { object: "list" } } });
    expect(await attest(invalid, pinnedServing(invalid))).toMatchObject({
      ok: false,
      reason: "models_listing_invalid",
    });
  });

  it("is not attested when the server serves a different model", async () => {
    const stub = await stubWith({
      servedModelId: "Qwen/Qwen2.5-7B-Instruct",
      attestation: matchingAttestation(),
    });
    const result = await attest(stub, pinnedServing(stub));
    expect(result).toMatchObject({
      ok: false,
      reason: "served_model_mismatch",
      fields: { served_model_id: "mismatch" },
    });
    expect(result.reported.servedModelIds).toEqual([
      "Qwen/Qwen2.5-7B-Instruct",
    ]);

    const lying = await stubWith({
      attestation: matchingAttestation({ served_model_id: "other/model" }),
    });
    expect(await attest(lying, pinnedServing(lying))).toMatchObject({
      ok: false,
      reason: "served_model_mismatch",
    });
  });

  it("fails on any reported revision that differs from the pin, in every mode", async () => {
    const stub = await stubWith({
      attestation: matchingAttestation({
        weights_revision: "ffffffffffffffffffffffffffffffffffffffff",
      }),
    });
    expect(await attest(stub, pinnedServing(stub))).toMatchObject({
      ok: false,
      reason: "metadata_mismatch",
      detail: "weights_revision",
      fields: { weights_revision: "mismatch" },
    });

    // A model card exposing a different tool parser fails even in the relaxed
    // development mode, which only waives UNREPORTED pins.
    const card = await stubWith({
      modelCard: { tool_parser: "vllm:pythonic" },
    });
    expect(
      await attest(
        card,
        pinnedServing(card, {
          MODEL_ATTESTATION_MODE: "served_model",
          MODEL_ATTESTATION_URL: undefined,
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "metadata_mismatch",
      fields: { tool_parser: "mismatch" },
    });
  });

  it("requires every pin configured and confirmed in strict mode", async () => {
    const stub = await stubWith({ attestation: matchingAttestation() });
    expect(
      await attest(
        stub,
        pinnedServing(stub, { MODEL_SERVING_IMAGE: undefined }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "pin_incomplete",
      detail: "serving_image",
    });

    // Pinned but reported by nothing: no attestation document configured.
    expect(
      await attest(
        stub,
        pinnedServing(stub, { MODEL_ATTESTATION_URL: undefined }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "metadata_unverified",
      fields: { weights_revision: "unverified", tool_parser: "unverified" },
    });

    // A configured document that is missing is not "nothing reported".
    stub.setOptions({ attestation: null });
    expect(await attest(stub, pinnedServing(stub))).toMatchObject({
      ok: false,
      reason: "attestation_document_unavailable",
      detail: "http_404",
    });
  });

  it("accepts revisions reported on the model card itself", async () => {
    const stub = await stubWith({
      modelCard: {
        weights_revision: WEIGHTS_REVISION.toUpperCase(),
        tokenizer_revision: "89abcdef0123456789abcdef0123456789abcdef",
        serving_image: SERVING_IMAGE,
        tool_parser: TOOL_PARSER,
      },
    });
    const result = await attest(
      stub,
      pinnedServing(stub, { MODEL_ATTESTATION_URL: undefined }),
    );
    expect(result.ok).toBe(true);
    expect(result.reported.sources).toEqual(["models"]);
  });

  it("marks a served-id-only attestation as partial in the audit revision", async () => {
    const stub = await stubWith();
    const result = await attest(
      stub,
      loadModelServingConfig(
        { MODEL_ATTESTATION_MODE: "served_model" },
        { model: SERVED_MODEL, revision: "2507" },
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.fields.weights_revision).toBe("not_pinned");
    expect(result.auditRevision).toMatch(/^2507\+att-partial\.[0-9a-f]{16}$/);
  });

  it("never attests an invalid pin", async () => {
    const stub = await stubWith({ attestation: matchingAttestation() });
    const result = await attest(
      stub,
      pinnedServing(stub, { MODEL_TOKENIZER_REVISION: "main" }),
    );
    expect(result).toMatchObject({ ok: false, reason: "pin_invalid" });
  });

  it("sends the bearer token to the model origin only", async () => {
    const model = await stubWith();
    const elsewhere = await stubWith({ attestation: matchingAttestation() });
    process.env.ATTEST_TEST_KEY = "secret-token";
    try {
      const provider = createHttpModelProvider({
        baseUrl: model.baseUrl,
        model: SERVED_MODEL,
        revision: "2507",
        serving: pinnedServing(elsewhere),
        apiKeyEnv: "ATTEST_TEST_KEY",
      });
      const result = await provider.attest?.();
      expect(result?.ok).toBe(true);
    } finally {
      delete process.env.ATTEST_TEST_KEY;
    }
    expect(model.modelListings()[0]?.headers.authorization).toBe(
      "Bearer secret-token",
    );
    expect(elsewhere.requests[0]?.headers.authorization).toBeUndefined();
  });
});

describe("the provider gates every completion on attestation", () => {
  it("never requests a completion from an unattested server", async () => {
    const stub = await stubWith({
      attestation: matchingAttestation({ tool_parser: "vllm:llama3_json" }),
      completions: [completion({ content: "should never be asked" })],
    });
    const provider = stubProvider(stub);
    const error = await provider
      .complete({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "service_unavailable",
      details: { reason: "model_unattested", attestation: "metadata_mismatch" },
    });
    expect(stub.completions()).toHaveLength(0);
  });

  it("an unconfigured provider is unattested by default", async () => {
    const stub = await stubWith({
      completions: [completion({ content: "x" })],
    });
    const provider = createHttpModelProvider({
      baseUrl: stub.baseUrl,
      model: SERVED_MODEL,
      revision: "2507",
    });
    await expect(
      provider.complete({ system: "s", messages: [], tools: [] }),
    ).rejects.toMatchObject({ details: { attestation: "pin_incomplete" } });
    expect(stub.completions()).toHaveLength(0);
  });

  it("caches a success for its TTL, re-checks after it, and retries failures sooner", async () => {
    const stub = await stubWith({
      attestation: matchingAttestation(),
      completions: () => completion({ content: "ok" }),
    });
    let clock = Date.parse("2026-09-23T10:00:00Z");
    const provider = stubProvider(stub, {
      now: () => new Date(clock),
      attestationTtlMs: 60_000,
      attestationRetryMs: 5_000,
    });
    const request = {
      system: "s",
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [],
    };

    const response = await provider.complete(request);
    expect(response.identity).toEqual({
      model: SERVED_MODEL,
      revision: provider.lastAttestation?.()?.auditRevision,
    });
    await provider.complete(request);
    expect(stub.modelListings()).toHaveLength(1);

    clock += 61_000;
    await provider.complete(request);
    expect(stub.modelListings()).toHaveLength(2);

    // The server is redeployed with a different image: the next re-check fails
    // and AI execution stops until the pin and the server agree again.
    stub.setOptions({
      attestation: matchingAttestation({
        serving_image: `vllm/vllm-openai@sha256:${"ee".repeat(32)}`,
      }),
    });
    clock += 61_000;
    await expect(provider.complete(request)).rejects.toMatchObject({
      details: { reason: "model_unattested" },
    });
    const completionsSoFar = stub.completions().length;
    stub.setOptions({ attestation: matchingAttestation() });
    clock += 1_000;
    await expect(provider.complete(request)).rejects.toMatchObject({
      details: { reason: "model_unattested" },
    });
    clock += 5_000;
    await provider.complete(request);
    expect(stub.completions().length).toBe(completionsSoFar + 1);

    // An explicit refresh always re-checks.
    const listings = stub.modelListings().length;
    await provider.attest?.({ force: true });
    expect(stub.modelListings().length).toBe(listings + 1);
  });
});

describe("readiness", () => {
  it("keeps the app ready with AI execution off, and says why, when the model is down", async () => {
    const dead = await deadBaseUrl();
    const provider = createHttpModelProvider({
      baseUrl: dead,
      model: SERVED_MODEL,
      revision: "2507",
      serving: pinnedServing({ attestationUrl: `${dead}/attestation.json` }),
    });
    const app = createApp(makeDeps(testDb(), { model: provider }));

    const first = await app.request("/health/ready");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      status: "ready",
      checks: { database: true, redis: true, model: false },
      capabilities: { app: true, aiExecution: false },
      ai: { ready: false, reason: "attestation_pending" },
    });

    await provider.attest?.();
    const second = await app.request("/health/ready");
    expect(second.status).toBe(200);
    const body = (await second.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      capabilities: { app: true, aiExecution: false },
      ai: { ready: false, reason: "endpoint_unreachable" },
    });
    // The public probe carries reason codes only, never the pinned artifacts.
    expect(JSON.stringify(body)).not.toContain(WEIGHTS_REVISION);

    expect((await app.request("/health/ready/ai")).status).toBe(403);
    expect(
      (
        await app.request("/health/ready/ai", {
          headers: { "X-Service-Key": "wrong" },
        })
      ).status,
    ).toBe(403);
    const internal = await app.request("/health/ready/ai", {
      headers: { "X-Service-Key": "attestation-test-key" },
    });
    expect(internal.status).toBe(503);
    expect(await internal.json()).toMatchObject({
      ready: false,
      reason: "endpoint_unreachable",
      attestation: { expected: { weightsRevision: WEIGHTS_REVISION } },
    });
  });

  it("reports AI execution ready only once the server attests", async () => {
    const stub = await stubWith({ attestation: matchingAttestation() });
    const provider = stubProvider(stub);
    const app = createApp(makeDeps(testDb(), { model: provider }));

    const internal = await app.request("/health/ready/ai?refresh=1", {
      headers: { "X-Service-Key": "attestation-test-key" },
    });
    expect(internal.status).toBe(200);
    const detail = (await internal.json()) as {
      attestation: { digest: string; auditRevision: string };
    };
    expect(detail.attestation.digest).toMatch(/^sha256:/);

    const ready = await app.request("/health/ready");
    expect(await ready.json()).toMatchObject({
      checks: { model: true },
      capabilities: { app: true, aiExecution: true },
      ai: { ready: true, reason: null },
    });
  });

  it("fails closed on the internal endpoint when no key is provisioned", async () => {
    const app = createApp(makeDeps(testDb()));
    delete process.env.INTERNAL_SERVICE_KEY;
    try {
      const response = await app.request("/health/ready/ai", {
        headers: { "X-Service-Key": "" },
      });
      expect(response.status).toBe(403);
    } finally {
      process.env.INTERNAL_SERVICE_KEY = "attestation-test-key";
    }
    // An in-process provider has nothing to attest: AI execution is not claimed.
    const ready = await app.request("/health/ready");
    expect(await ready.json()).toMatchObject({
      ai: { ready: false, reason: "attestation_unsupported" },
    });
  });

  it("serves regular flows while the model is down; the model turn fails as service_unavailable", async () => {
    const dead = await deadBaseUrl();
    const provider = createHttpModelProvider({
      baseUrl: dead,
      model: SERVED_MODEL,
      revision: "2507",
      serving: pinnedServing({ attestationUrl: `${dead}/attestation.json` }),
    });
    const db = testDb();
    const cityId = await seedCity(db);
    const actor = rider();
    const app = createApp(makeDeps(db, { model: provider }));
    const headers = {
      "Content-Type": "application/json",
      "X-User-ID": actor.id,
      "X-User-Role": "rider",
      "X-City-ID": cityId,
    };

    const opened = await app.request("/v1/ask/threads", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": `open-${actor.id}` },
      body: JSON.stringify({ source: "home" }),
    });
    expect(opened.status).toBe(201);
    const thread = (await opened.json()) as { id: string };

    const message = await app.request(`/v1/ask/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": `msg-${actor.id}` },
      body: JSON.stringify({ text: "quote me a ride" }),
    });
    expect(message.status).toBe(503);
    expect(await message.json()).toMatchObject({
      code: "service_unavailable",
      details: {
        reason: "model_unattested",
        attestation: "endpoint_unreachable",
      },
    });
    // Nothing half-written: no messages were persisted for the failed turn.
    expect(await db.askMessage.count({ where: { threadId: thread.id } })).toBe(
      0,
    );
  });
});
