/**
 * Server-only. Driver requirements for a city come from user-service
 * (`GET /v1/kyc/requirements?cityId=&role=driver`); the marketing site never
 * hard-codes a document. Cached under the "requirements" tag; a failed read
 * throws inside the cache so the outage is not stored, and the page hides the
 * list rather than guessing.
 */
import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";

import {
  REQUIREMENTS_REVALIDATE_SECONDS as REVALIDATE_SECONDS,
  REQUIREMENTS_TAG,
} from "./cache-tags";

export { REQUIREMENTS_TAG };

const RequirementDocumentSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().optional(),
  required: z.boolean(),
  owner: z.enum(["driver", "vehicle", "identity"]),
});

const RequirementsBodySchema = z.object({
  cityId: z.string().min(1),
  role: z.literal("driver"),
  documents: z.array(RequirementDocumentSchema),
});

/** user-service answers `{ success, data }`; the bare body is accepted too. */
const RequirementsResponseSchema = z.union([
  z.object({ success: z.literal(true), data: RequirementsBodySchema }),
  RequirementsBodySchema,
]);

export type RequirementDocument = z.infer<typeof RequirementDocumentSchema>;

export interface Requirement {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
}

export type RequirementsResult =
  | { readonly status: "ok"; readonly items: readonly Requirement[] }
  | { readonly status: "error" };

class RequirementsUnavailable extends Error {}

const requirementsRead = unstable_cache(
  async (cityId: string): Promise<RequirementDocument[] | null> => {
    const base = process.env.UBI_USER_BASE_URL?.trim();
    if (!base) throw new RequirementsUnavailable("user_service_unconfigured");
    const token = process.env.UBI_CONFIG_SERVICE_TOKEN?.trim();
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/v1/kyc/requirements?cityId=${encodeURIComponent(cityId)}&role=driver`,
          base,
        ),
        {
          headers: {
            accept: "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch {
      throw new RequirementsUnavailable("user_service_unreachable");
    }
    // No requirements published for this city: a real answer, cacheable.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new RequirementsUnavailable(`user_service_${response.status}`);
    }
    const parsed = RequirementsResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new RequirementsUnavailable("user_service_invalid");
    return "data" in parsed.data
      ? parsed.data.data.documents
      : parsed.data.documents;
  },
  ["marketing", "kyc-requirements"],
  { revalidate: REVALIDATE_SECONDS, tags: [REQUIREMENTS_TAG] },
);

/**
 * The list a driver sees on /drive, grouped the way board 24d reads: driver
 * and identity items one per line, vehicle papers as one line.
 */
export async function getDriverRequirements(
  cityId: string,
): Promise<RequirementsResult> {
  let documents: RequirementDocument[] | null;
  try {
    documents = await requirementsRead(cityId.toUpperCase());
  } catch {
    return { status: "error" };
  }
  if (documents === null) return { status: "error" };

  const required = documents.filter((d) => d.required);
  // Board 24d order: driver and identity items one per line in the order the
  // service lists them; the vehicle papers become one line where the first
  // vehicle document appears.
  const items: Requirement[] = [];
  let vehicleAdded = false;
  for (const document of required) {
    if (document.owner === "vehicle") {
      if (vehicleAdded) continue;
      vehicleAdded = true;
      items.push({
        id: "vehicle_papers",
        title: "Vehicle papers",
        detail: required
          .filter((d) => d.owner === "vehicle")
          .map((d) => d.title)
          .join(", "),
      });
      continue;
    }
    items.push({
      id: document.type,
      title: document.title,
      ...(document.detail ? { detail: document.detail } : {}),
    });
  }
  return { status: "ok", items };
}
