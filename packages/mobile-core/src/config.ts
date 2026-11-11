// City config is the source of currency, emergency number, offer TTLs, PIN policy. Never constants.
import React, { createContext, useContext, useEffect, useState } from "react";
import {
  CityConfigSchema,
  PaymentMethodConfigSchema,
  type CityConfig,
  type PaymentMethodConfig,
} from "@ubi/contracts";
import { api } from "./api";

export {
  CityConfigSchema,
  PaymentMethodConfigSchema,
  type CityConfig,
  type PaymentMethodConfig,
};
export type CityPaymentMethod = PaymentMethodConfig;

export function parseCityConfig(raw: unknown): CityConfig {
  return CityConfigSchema.parse(raw);
}

const Ctx = createContext<{
  config?: CityConfig;
  status: "loading" | "ready" | "error";
  error?: string;
}>({ status: "loading" });
export function ConfigProvider({
  cityId,
  children,
}: {
  cityId: string | undefined;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<{
    config?: CityConfig;
    status: "loading" | "ready" | "error";
    error?: string;
  }>({ status: "loading" });
  useEffect(() => {
    if (!cityId) return;
    api<unknown>("GET", "/v1/config/cities/" + encodeURIComponent(cityId))
      .then((raw) =>
        setState({ config: parseCityConfig(raw), status: "ready" }),
      )
      .catch((e) => setState({ status: "error", error: String(e) }));
  }, [cityId]);
  return React.createElement(Ctx.Provider, { value: state }, children);
}
export const useCityConfig = () => useContext(Ctx);
