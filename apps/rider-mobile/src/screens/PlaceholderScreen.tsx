import React from 'react';
import { Screen, Text } from '@ubi/mobile-ui';
/** Stands in for RN-01 ported screens (boards 1–19) until those slices land. Never shipped: RN-01 acceptance replaces every use. */
export function PlaceholderScreen({ route }: { route: { name: string; params?: unknown } }) {
  return <Screen title={route.name}><Text tone="text2">Ported in RN-01 from the launch board (see MIGRATION_MAP.md).</Text></Screen>;
}
