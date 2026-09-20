// DEV ONLY. Installed when __DEV__ && UBI_FIXTURES=1 (App.tsx). Screens never import this; they call src/api/*.
import { installFixtures } from '@ubi/mobile-core';
import { askFixtures } from './ask';
import { travelFixtures } from './travel';
import { benefitsFixtures } from './benefits';
import { mandateFixtures } from './mandates';
import { marketplaceFixtures } from './marketplace';
export function installDevFixtures() {
  const all = [askFixtures, travelFixtures, benefitsFixtures, mandateFixtures, marketplaceFixtures];
  installFixtures(async (input) => { for (const h of all) { const r = await h(input); if (r) return r; } return undefined; });
}
export { ok, NGN, type FixtureInput } from './shared';
