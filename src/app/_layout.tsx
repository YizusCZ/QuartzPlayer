import { useEffect, type ReactElement } from 'react';
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
import { startUpdateChecks } from '@/lib/appUpdate';
import { recoverPendingPick } from '@/lib/userMedia';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { TrackActions } from '@/components/TrackActions';
import { GlobalImportSheet } from '@/components/ImportPlaylistSheet';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { UpdateSheet } from '@/components/UpdateSheet';
import { NewPlaylistSheet } from '@/components/NewPlaylistSheet';
import { Toast } from '@/components/Toast';
import { TourOverlay } from '@/components/tour/Tour';
import { colors, glassOn, useAccent } from '@/theme';

/**
 * Liquid Glass: every screen on its own backdrop, so none shows through
 * another. The player and the room move theirs with them while being dragged.
 */
function glassScreen({ route, children }: { route: { name: string }; children: ReactElement }) {
  if (route.name === 'player' || route.name === 'jam') return children;
  return (
    <View style={{ flex: 1, backgroundColor: colors.base }}>
      <GlassBackdrop />
      {children}
    </View>
  );
}

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
      startUpdateChecks();
    });
  }, []);

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.base }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
          <Stack
            screenLayout={glassOn ? glassScreen : undefined}
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
            <Stack.Screen
              name="jam"
              // Transparent like the player: dragging the room down shows the app behind it.
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
          <GlobalImportSheet />
          <UpdateSheet />
          <ConfirmDialog />
          <Toast />
          <TourOverlay />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
