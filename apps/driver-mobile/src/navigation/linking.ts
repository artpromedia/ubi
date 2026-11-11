import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./routes";

// Deep-link surface for UBI Driver (`ubidriver://` + universal links on
// `driver.ubi.africa`). Disabled verticals land on `MarketplaceGate` /
// `FlagGate` / `FleetGate` inside each target screen rather than crashing.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["ubidriver://", "https://driver.ubi.africa"],
  config: {
    screens: {
      Main: {
        screens: {
          Home: "home",
          Requests: {
            screens: {
              Feed: "requests",
              Detail: "requests/:requestId",
            },
          },
          Earnings: {
            screens: {
              Statement: "earnings/statement/:periodId",
              Payouts: "earnings/payouts",
              Cashout: "earnings/cashout",
            },
          },
          Incentives: {
            screens: {
              Overview: "incentives",
            },
          },
          Account: {
            screens: {
              Profile: "profile",
            },
          },
        },
      },
      Jobs: "jobs",
      Calendar: "calendar",
      MpTrip: "trips/:requestId",
      MpAmendments: "trips/:requestId/amendments",
      DeliveryJob: "deliveries/:deliveryId",
      WalletHolds: "wallet/holds",
      Rates: "rates",
      Preferences: "preferences",
      FleetSchedule: "fleet/schedule",
      FleetConflict: "fleet/conflicts/:conflictId",
      FlagOff: "unavailable/:feature",
    },
  },
};
