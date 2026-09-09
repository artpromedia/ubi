import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '@ubi/mobile-ui';
import { FlagsProvider, ConfigProvider, configureApi, loadSession } from '@ubi/mobile-core';
import { RootNavigator } from './src/navigation/RootNavigator';
import { installDevFixtures } from './src/dev/fixtures';

configureApi({ baseUrl: process.env.UBI_API_BASE ?? 'https://api.ubi.africa' });
if (__DEV__ && process.env.UBI_FIXTURES === '1') installDevFixtures();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
/** Driver ships dark-default (launch CLAUDE.md #10). */
export default function App() {
  const [cityId, setCityId] = useState<string | undefined>();
  useEffect(() => { loadSession().then(() => setCityId('LOS')); }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><QueryClientProvider client={queryClient}><ConfigProvider cityId={cityId}><FlagsProvider cityId={cityId}><ThemeProvider defaultMode="dark"><RootNavigator /></ThemeProvider></FlagsProvider></ConfigProvider></QueryClientProvider></SafeAreaProvider></GestureHandlerRootView>
  );
}
