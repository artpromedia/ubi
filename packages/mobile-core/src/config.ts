// City config is the source of currency, emergency number, offer TTLs, PIN policy. Never constants.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

export type CityConfig = {
  cityId: string; countryCode: string; timezone: string; currency: string; currencySymbol: string; minorDigitsShown: number; locale: string;
  emergencyNumber: string; offerTtlSec: number; quoteTtlSec: number; reservationFreeCancelMin: number; supportPhone: string;
};
const Ctx = createContext<{ config?: CityConfig; status: 'loading' | 'ready' | 'error'; error?: string }>({ status: 'loading' });
export function ConfigProvider({ cityId, children }: { cityId: string | undefined; children: React.ReactNode }) {
  const [state, setState] = useState<{ config?: CityConfig; status: 'loading' | 'ready' | 'error'; error?: string }>({ status: 'loading' });
  useEffect(() => {
    if (!cityId) return;
    api<CityConfig>('GET', '/v1/config/cities/' + encodeURIComponent(cityId)).then(config => setState({ config, status: 'ready' })).catch(e => setState({ status: 'error', error: String(e) }));
  }, [cityId]);
  return React.createElement(Ctx.Provider, { value: state }, children);
}
export const useCityConfig = () => useContext(Ctx);
