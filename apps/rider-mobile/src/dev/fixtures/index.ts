// DEV ONLY. Installed when __DEV__ && UBI_FIXTURES=1 (App.tsx). Screens never import this; they call src/api/*.
import { installFixtures } from '@ubi/mobile-core';
import { askFixtures } from './ask';
import { travelFixtures } from './travel';
import { benefitsFixtures } from './benefits';
import { mandateFixtures } from './mandates';
export function installDevFixtures() {
  const all = [askFixtures, travelFixtures, benefitsFixtures, mandateFixtures];
  installFixtures(async (input) => { for (const h of all) { const r = await h(input); if (r) return r; } return undefined; });
}
export type FixtureInput = { method: string; path: string; body?: unknown };
export const ok = (json: unknown) => ({ status: 200, json });
export const NGN = (major: number) => ({ amountMinor: Math.round(major * 100), currency: 'NGN' });
