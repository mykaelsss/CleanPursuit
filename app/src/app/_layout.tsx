import { LilitaOne_400Regular, useFonts } from '@expo-google-fonts/lilita-one';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LivePartyProvider } from '@/lib/live-party';
import { RewardsProvider } from '@/lib/rewards';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // If the font fails to load, carry on with the system font rather than holding the splash screen.
  const [fontsLoaded, fontError] = useFonts({ LilitaOne_400Regular });
  return (
    // The quests screen's bottom sheets need a gesture handler root.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          {/* Shows the XP popup over any screen, and hears from the live party when a cleanup ends. */}
          <RewardsProvider>
            <LivePartyProvider>
              <RootNavigator fontsReady={fontsLoaded || !!fontError} />
            </LivePartyProvider>
          </RewardsProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useAuth();
  const ready = fontsReady && status !== 'loading';

  // Keep the splash screen up until fonts are loaded and we know whether a session was restored.
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const signedIn = status === 'signedIn';
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="quests/[id]/dropoffs" options={{ headerShown: true, headerBackTitle: 'Back' }} />
        <Stack.Screen name="resources" options={{ headerShown: true, headerBackTitle: 'Back' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
