/**
 * What a driver must provide before going online, per city (board 3c / 13b).
 *
 * Built from the document types this service already reviews
 * (`DOCUMENT_TYPES`, `DOCUMENT_LABELS`) plus the identity check the step-up
 * module performs (NIN + selfie liveness). The marketing site and the driver
 * app read this through `GET /v1/kyc/requirements`; neither hard-codes a
 * document.
 *
 * Lagos requires the LASDRI card (Lagos State Drivers' Institute); Abuja has
 * no equivalent. Everything else is the same federal set.
 */
import { ContractError } from "@ubi/contracts";

import {
  DOCUMENT_LABELS,
  type DocumentType,
  DRIVER_DOCUMENT_TYPES,
  VEHICLE_DOCUMENT_TYPES,
} from "./documents";

export type RequirementOwner = "driver" | "vehicle" | "identity";

export interface DriverRequirement {
  readonly type: DocumentType | "nin_identity";
  readonly title: string;
  readonly detail: string;
  readonly required: boolean;
  readonly owner: RequirementOwner;
}

export interface DriverRequirements {
  readonly cityId: string;
  readonly role: "driver";
  readonly documents: readonly DriverRequirement[];
}

const DETAIL: Readonly<Record<DocumentType | "nin_identity", string>> = {
  licence: "Valid, in your name",
  lasdri: "Lagos State Drivers' Institute",
  background_check: "You consent in the app; UBI runs it",
  insurance: "Third-party insurance",
  roadworthiness: "Current roadworthiness certificate",
  vehicle_registration: "Registration in the name shown on the licence",
  nin_identity: "NIN, plus a selfie check in the app",
};

const TITLE: Readonly<Record<DocumentType | "nin_identity", string>> = {
  licence: capitalise(DOCUMENT_LABELS.licence),
  lasdri: DOCUMENT_LABELS.lasdri,
  background_check: capitalise(DOCUMENT_LABELS.background_check),
  insurance: "Third-party insurance",
  roadworthiness: "Roadworthiness",
  vehicle_registration: "Registration",
  nin_identity: "Identity",
};

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function requirement(
  type: DocumentType | "nin_identity",
  owner: RequirementOwner,
): DriverRequirement {
  return {
    type,
    title: TITLE[type],
    detail: DETAIL[type],
    required: true,
    owner,
  };
}

/** The federal set every Nigerian city shares, in the order the app shows them. */
function federalSet(): DriverRequirement[] {
  const driverDocuments = DRIVER_DOCUMENT_TYPES.filter(
    (type) => type !== "lasdri",
  );
  return [
    requirement("licence", "driver"),
    requirement("nin_identity", "identity"),
    ...VEHICLE_DOCUMENT_TYPES.map((type) => requirement(type, "vehicle")),
    ...driverDocuments
      .filter((type) => type !== "licence")
      .map((type) => requirement(type, "driver")),
  ];
}

/** Lagos adds the LASDRI card straight after the licence. */
function lagosSet(): DriverRequirement[] {
  const [licence, ...rest] = federalSet();
  return [
    licence as DriverRequirement,
    requirement("lasdri", "driver"),
    ...rest,
  ];
}

export const DRIVER_REQUIREMENTS_BY_CITY: Readonly<
  Record<string, readonly DriverRequirement[]>
> = {
  LOS: lagosSet(),
  ABV: federalSet(),
};

export const REQUIREMENT_ROLES = ["driver"] as const;

export function driverRequirementsFor(cityIdRaw: string): DriverRequirements {
  const cityId = cityIdRaw.trim().toUpperCase();
  const documents = DRIVER_REQUIREMENTS_BY_CITY[cityId];
  if (documents === undefined) {
    throw new ContractError(
      "city_unsupported",
      "No driver requirements are published for this city yet",
      { cityId },
    );
  }
  return { cityId, role: "driver", documents };
}
