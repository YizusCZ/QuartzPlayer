import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { Caveat_600SemiBold } from '@expo-google-fonts/caveat';
import { Michroma_400Regular } from '@expo-google-fonts/michroma';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initEngine } from '@/audio/engine';
import { startAudioRoute } from '@/audio/route';
import { startEq } from '@/audio/eq';
import { startFx } from '@/audio/fx';
import { startDiscordPresence } from '@/integrations/discord';
import { startLibraryWatch } from '@/library/scanner';
import { recoverPendingPick } from '@/lib/userMedia';
import { TrackActions } from '@/components/TrackActions';
import { NewPlaylistSheet } from '@/components/NewPlaylistSheet';
import { Toast } from '@/components/Toast';
import { colors, useAccent } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useAccent();
  const [loaded, error] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    Caveat_600SemiBold,
    Michroma_400Regular,
  });

  useEffect(() => {
    void initEngine().then(() => {
      startLibraryWatch();
      startAudioRoute();
      startEq();
      startFx();
      startDiscordPresence();
      void recoverPendingPick();
    });
  }, []);

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen
              name="player"
              // Transparent so the library stays visible behind while you drag the player down.
              options={{
                presentation: 'transparentModal',
                animation: 'slide_from_bottom',
                gestureEnabled: false,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen name="queue" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="info" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
          <TrackActions />
          <NewPlaylistSheet />
          <Toast />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
