import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AlertBanner } from '@/components/AlertBanner';
import { AlertsProvider } from '@/store/alerts';
import { DataProvider } from '@/store/data';
import { SettingsProvider } from '@/store/settings';
import { TrafficProvider } from '@/store/traffic';
import { useTheme } from '@/theme';

function RootNavigator() {
  const { colors, isDark } = useTheme();
  const base = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="hotspot/[id]" options={{ title: 'Trecho de risco' }} />
        <Stack.Screen name="about" options={{ title: 'Sobre o RiskRadar' }} />
      </Stack>
      <AlertBanner />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  useColorScheme();
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <DataProvider>
          <TrafficProvider>
            <AlertsProvider>
              <RootNavigator />
            </AlertsProvider>
          </TrafficProvider>
        </DataProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
