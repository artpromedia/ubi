// Profile against user-service THROUGH the gateway (C05 / G12). Route
// verified in services/user-service/src/routes/users.ts:
//   GET /v1/users/me -> { success, data: { user } }
// Vehicle, documents, ratings, fleet arrangement and liveness are NOT built
// here (see api/unsupported.ts driverDocuments) — this module is the
// Profile view only, matching this slice's audited scope.
import { api } from "@ubi/mobile-core";
import type { Envelope } from "./auth";

export type Profile = {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  language?: string;
  country?: string;
};

export const accountApi = {
  me: async (): Promise<Profile> => {
    const r = await api<Envelope<{ user: Profile }>>("GET", "/v1/users/me");
    return r.data.user;
  },
};
