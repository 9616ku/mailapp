import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { useAccount } from '@/store/account';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { account, loaded, load } = useAccount();

  useEffect(() => {
    load().finally(() => SplashScreen.hideAsync());
  }, [load]);

  if (!loaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Protected guard={!account}>
            <Stack.Screen name="login" options={{ title: 'アカウント設定' }} />
          </Stack.Protected>
          <Stack.Protected guard={!!account}>
            <Stack.Screen name="index" options={{ title: 'メールボックス', headerLargeTitle: true }} />
            <Stack.Screen name="folder/[path]" options={{ title: '' }} />
            <Stack.Screen name="message/[uid]" options={{ title: '' }} />
            <Stack.Screen name="compose" options={{ presentation: 'modal', title: '新規メッセージ' }} />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
