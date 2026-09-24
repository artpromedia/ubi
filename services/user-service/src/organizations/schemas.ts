/**
 * Request bodies for the organization routes. Mirrors the input schemas in
 * packages/contracts/src/business-travel.ts; the policy vocabularies (services
 * and vehicle classes) come straight from @ubi/contracts so a new marketplace
 * service or class is allowed here the moment it exists there.
 */
import { z } from "zod";

import { MP_SERVICES, VEHICLE_CLASSES } from "@ubi/contracts";

import { ORG_ROLES } from "./model";

const E164 = /^\+[1-9]\d{6,14}$/;

const RoleSchema = z.enum(ORG_ROLES);

export const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  cityId: z.string().min(1).max(64),
  legalName: z.string().trim().min(2).max(200).optional(),
  taxId: z.string().trim().min(2).max(64).optional(),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;

export const UpdatePolicySchema = z.object({
  tripCapMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  allowedServices: z.array(z.enum(MP_SERVICES)).max(MP_SERVICES.length),
  allowedClasses: z.array(z.enum(VEHICLE_CLASSES)).max(VEHICLE_CLASSES.length),
  expectedPolicyVersion: z.number().int().min(1),
});
export type UpdatePolicyInput = z.infer<typeof UpdatePolicySchema>;

export const UpdateBillingSchema = z.object({
  legalName: z.string().trim().min(2).max(200).nullable(),
  taxId: z.string().trim().min(2).max(64).nullable(),
});
export type UpdateBillingInput = z.infer<typeof UpdateBillingSchema>;

export const CreateCostCentreSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, "a cost centre code is letters, digits, . _ -"),
  name: z.string().trim().min(1).max(120),
});
export type CreateCostCentreInput = z.infer<typeof CreateCostCentreSchema>;

export const InviteMemberSchema = z.object({
  phone: z.string().regex(E164, "phone must be E.164, e.g. +2348012345678"),
  role: RoleSchema,
  costCentreId: z.string().min(1).optional(),
});
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

export const UpdateMemberSchema = z
  .object({
    role: RoleSchema.optional(),
    costCentreId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) => value.role !== undefined || value.costCentreId !== undefined,
    { message: "name a role or a cost centre to change" },
  );
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
