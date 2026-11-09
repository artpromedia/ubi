import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "node:test";

import {
  createChildLogger,
  createLogger,
  DEFAULT_REDACT_PATHS,
  REDACTED_VALUE,
} from "../dist/index.mjs";

function captureLogger(extraConfig = {}) {
  const lines = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString("utf8").trim());
      callback();
    },
  });
  const log = createLogger({
    name: "redact-test",
    level: "debug",
    pretty: false,
    destination,
    ...extraConfig,
  });
  return {
    log,
    entries: () => lines.filter(Boolean).map((line) => JSON.parse(line)),
  };
}

describe("@ubi/logger PII and secret redaction", () => {
  it("redacts top-level and nested phone, email, otp, code, token, authorization, and pin fields", () => {
    const { log, entries } = captureLogger();

    log.info(
      {
        userId: "usr_safe_123",
        phone: "+2348012345678",
        email: "ada@example.com",
        otp: "482910",
        code: "482910",
        token: "eyJhbGciOiJIUzI1NiJ9.secret",
        authorization: "Bearer secret-jwt",
        pin: "1984",
        payload: {
          phone: "+2348099999999",
          email: "nested@example.com",
          otp: "111222",
          code: "333444",
          accessToken: "nested-access-token",
          refreshToken: "nested-refresh-token",
          pin: "9999",
        },
        headers: {
          authorization: "Bearer header-jwt",
          "x-service-key": "super-secret-service-key-32-chars",
          "x-ubi-identity": "signed-identity-header",
        },
      },
      "auth attempt",
    );

    const [entry] = entries();
    assert.equal(entry.userId, "usr_safe_123");
    assert.equal(entry.phone, REDACTED_VALUE);
    assert.equal(entry.email, REDACTED_VALUE);
    assert.equal(entry.otp, REDACTED_VALUE);
    assert.equal(entry.code, REDACTED_VALUE);
    assert.equal(entry.token, REDACTED_VALUE);
    assert.equal(entry.authorization, REDACTED_VALUE);
    assert.equal(entry.pin, REDACTED_VALUE);
    assert.equal(entry.payload.phone, REDACTED_VALUE);
    assert.equal(entry.payload.email, REDACTED_VALUE);
    assert.equal(entry.payload.otp, REDACTED_VALUE);
    assert.equal(entry.payload.code, REDACTED_VALUE);
    assert.equal(entry.payload.accessToken, REDACTED_VALUE);
    assert.equal(entry.payload.refreshToken, REDACTED_VALUE);
    assert.equal(entry.payload.pin, REDACTED_VALUE);
    assert.equal(entry.headers.authorization, REDACTED_VALUE);
    assert.equal(entry.headers["x-service-key"], REDACTED_VALUE);
    assert.equal(entry.headers["x-ubi-identity"], REDACTED_VALUE);

    const serialized = JSON.stringify(entry);
    for (const secret of [
      "+2348012345678",
      "+2348099999999",
      "ada@example.com",
      "nested@example.com",
      "482910",
      "111222",
      "333444",
      "secret-jwt",
      "1984",
      "super-secret-service-key-32-chars",
    ]) {
      assert.equal(
        serialized.includes(secret),
        false,
        `expected ${secret} to be redacted`,
      );
    }
  });

  it("preserves redaction across child loggers", () => {
    const { log, entries } = captureLogger();
    const child = createChildLogger(log, {
      component: "auth",
      phone: "+2348011112222",
    });

    child.warn({ otp: "654321" }, "otp event");

    const [entry] = entries();
    assert.equal(entry.component, "auth");
    assert.equal(entry.phone, REDACTED_VALUE);
    assert.equal(entry.otp, REDACTED_VALUE);
  });

  it("exposes the canonical default redact path list as a non-empty contract", () => {
    for (const required of [
      "phone",
      "email",
      "otp",
      "code",
      "token",
      "authorization",
      "pin",
    ]) {
      assert.equal(
        DEFAULT_REDACT_PATHS.includes(required),
        true,
        `DEFAULT_REDACT_PATHS must include ${required}`,
      );
    }
  });
});
