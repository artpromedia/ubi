/**
 * Hashing for short secrets — wallet PINs and phone OTPs.
 *
 * Both are only four to six digits, so the whole keyspace is tiny and a fast
 * digest would be broken offline in seconds. scrypt is memory-hard and
 * deliberately slow, which is what makes a stolen hash worth little inside the
 * few minutes an OTP lives.
 *
 * `node:crypto` rather than bcrypt: scrypt is built into Node, so there is no
 * native addon to build and nothing to go missing at runtime, and the cost
 * parameters are recorded in the encoded value so they can be raised later
 * without invalidating what is already stored.
 */
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAXMEM = 64 * 1024 * 1024;
const PREFIX = "scrypt";

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(secret, salt, KEY_LENGTH, {
    ...COST,
    maxmem: MAXMEM,
  });
  return [
    PREFIX,
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifySecret(
  secret: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltPart = parts[4];
  const hashPart = parts[5];
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    saltPart === undefined ||
    hashPart === undefined
  ) {
    return false;
  }

  const expected = Buffer.from(hashPart, "base64url");
  const derived = await scrypt(
    secret,
    Buffer.from(saltPart, "base64url"),
    expected.length,
    {
      N,
      r,
      p,
      maxmem: MAXMEM,
    },
  );
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

/** True when the value looks like something this module produced. */
export function isHashedSecret(value: string): boolean {
  return value.startsWith(`${PREFIX}$`);
}
