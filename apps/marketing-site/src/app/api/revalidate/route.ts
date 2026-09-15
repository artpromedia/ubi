/**
 * On-demand revalidation. config-service's marketing consumer calls this when
 * a config version is activated, a flag changes or a city's status changes,
 * so a service that switches on is reflected within one request instead of
 * after the 300 s window.
 *
 * Authenticated with a shared secret (bearer token, constant-time compare).
 * Fails closed: no secret configured ⇒ 503, wrong secret ⇒ 401.
 */
import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AVAILABILITY_TAG, REQUIREMENTS_TAG } from "@/lib/cache-tags";

export const dynamic = "force-dynamic";

const ALLOWED_TAGS = [AVAILABILITY_TAG, REQUIREMENTS_TAG] as const;

const BodySchema = z
  .object({
    tags: z.array(z.enum(ALLOWED_TAGS)).min(1).optional(),
    reason: z.string().max(200).optional(),
  })
  .strict();

function presentedSecret(request: Request): string | undefined {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim();
}

function secretMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.UBI_REVALIDATE_SECRET?.trim();
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      {
        code: "service_unavailable",
        message: "revalidation is not configured",
      },
      { status: 503 },
    );
  }
  if (!secretMatches(presentedSecret(request), expected)) {
    return NextResponse.json(
      { code: "unauthorized", message: "authentication required" },
      { status: 401 },
    );
  }

  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim() !== "") {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      return NextResponse.json(
        { code: "validation_failed", message: "body must be JSON" },
        { status: 422 },
      );
    }
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "validation_failed", message: "unknown field or tag" },
      { status: 422 },
    );
  }

  const tags = parsed.data.tags ?? [...ALLOWED_TAGS];
  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({
    revalidated: true,
    tags,
    at: new Date().toISOString(),
  });
}
