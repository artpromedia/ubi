// Business travel (A06 part C) — the rider's organizations, read from user-service THROUGH
// the gateway (services/user-service/src/routes/organizations.ts, signed context only):
//   GET /v1/organizations                      -> { success, data: { organizations } }
//   GET /v1/organizations/:orgId/cost-centres  -> { success, data: { costCentres } }
//   GET /v1/organizations/:orgId/members       -> { success, data: { members } }
// Only reads live here. Booking a ride on an organization is the marketplace publish
// (`business` + paymentMethodId "business"); its policy and budget are decided by the
// server — an advisory verdict on the quote, and again atomically when an offer is chosen.
// The app never computes a budget, a cap or a remaining balance.
import { api } from "@ubi/mobile-core";
import type {
  OrgCostCentreView,
  OrgMemberView,
  OrganizationView,
} from "@ubi/contracts";
import type { Envelope } from "./auth";

export type { OrgCostCentreView, OrgMemberView, OrganizationView };

const orgPath = (orgId: string) =>
  "/v1/organizations/" + encodeURIComponent(orgId);

export const businessApi = {
  organizations: async (): Promise<OrganizationView[]> => {
    const r = await api<Envelope<{ organizations: OrganizationView[] }>>(
      "GET",
      "/v1/organizations",
    );
    return r.data.organizations;
  },
  costCentres: async (orgId: string): Promise<OrgCostCentreView[]> => {
    const r = await api<Envelope<{ costCentres: OrgCostCentreView[] }>>(
      "GET",
      orgPath(orgId) + "/cost-centres",
    );
    return r.data.costCentres;
  },
  // Colleagues' display names (never a phone or trip): only a booker may book for one.
  members: async (orgId: string): Promise<OrgMemberView[]> => {
    const r = await api<Envelope<{ members: OrgMemberView[] }>>(
      "GET",
      orgPath(orgId) + "/members",
    );
    return r.data.members;
  },
};
