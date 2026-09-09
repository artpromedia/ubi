import React from 'react';
import { Screen, Text } from '@ubi/mobile-ui';
export function PlaceholderScreen({ route }: { route: { name: string } }) { return <Screen title={route.name}><Text tone="text2">Ported in RN-02 from the launch board (MIGRATION_MAP.md).</Text></Screen>; }
