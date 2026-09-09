// Deny-by-default flags, evaluated server-side per city (launch CLAUDE.md #5). Unreachable config ⇒ DENY_ALL. Never cache a denied result.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { DENY_ALL, isEnabled, type FlagKey, type FlagSet } from '@ubi/contracts';
import { api } from './api';

// New keys introduced by this handoff; register them in packages/contracts/src/flags.ts FLAG_KEYS (closed registry).
export type NewFlagKey = 'ai_assistant' | 'ai_transactions' | 'ai_mandates' | 'flights_booking' | 'stays_booking' | 'rider_promotions' | 'driver_commission_rebates' | 'referrals' | 'ai_marketing';
export type AnyFlag = FlagKey | NewFlagKey;

type Ctx = { flags: FlagSet & Partial<Record<NewFlagKey, boolean>>; status: 'loading' | 'ready' | 'denied'; refresh: () => Promise<void> };
const FlagsContext = createContext<Ctx>({ flags: DENY_ALL, status: 'loading', refresh: async () => {} });

export function FlagsProvider({ cityId, children }: { cityId: string | undefined; children: React.ReactNode }) {
  const [state, setState] = useState<Omit<Ctx, 'refresh'>>({ flags: DENY_ALL, status: 'loading' });
  const refresh = async () => {
    if (!cityId) { setState({ flags: DENY_ALL, status: 'denied' }); return; }
    try {
      const flags = await api<Record<string, boolean>>('GET', '/v1/config/flags?cityId=' + encodeURIComponent(cityId));
      if (!flags || typeof flags !== 'object') throw new Error('bad flag map');
      setState({ flags: flags as Ctx['flags'], status: 'ready' });
    } catch { setState({ flags: DENY_ALL, status: 'denied' }); }
  };
  useEffect(() => { void refresh(); }, [cityId]);
  return React.createElement(FlagsContext.Provider, { value: { ...state, refresh } }, children);
}
export function useFlags() { return useContext(FlagsContext); }
export function useFlag(key: AnyFlag): boolean {
  const { flags } = useFlags();
  return isEnabled(flags as FlagSet, key as FlagKey) || (flags as Record<string, boolean | undefined>)[key] === true;
}
