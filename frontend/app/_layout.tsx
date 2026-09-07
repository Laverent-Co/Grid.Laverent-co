import { QueryClientProvider } from "@tanstack/react-query";
import * as Font from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync().catch(() => {});

// Pre-warm the vector icon font so it renders in Expo Go on Android.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FeatherFontModule = require("@react-native-vector-icons/feather/fonts/Feather.ttf");
  Font.loadAsync({ Feather: FeatherFontModule }).catch(() => {});
} catch {}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        // Google-hosted TTFs (no @expo-google-fonts packages).
        await Font.loadAsync({
          Rajdhani_500Medium: "https://fonts.gstatic.com/s/rajdhani/v15/LDIxapCSOBg7S-QT7pasEcOsc-bGkqIw.ttf",
          Rajdhani_600SemiBold: "https://fonts.gstatic.com/s/rajdhani/v15/LDIxapCSOBg7S-QT7pashsOsc-bGkqIw.ttf",
          IBMPlexSans_400Regular: "https://fonts.gstatic.com/s/ibmplexsans/v19/zYXgKVElMYYaJe8bpLHnCwDKhdHeFaxOedc.ttf",
          IBMPlexSans_500Medium: "https://fonts.gstatic.com/s/ibmplexsans/v19/zYX9KVElMYYaJe8bpLHnCwDKjQ76AIxsdO_q.ttf",
        });
      } catch {}
      setReady(true);
      SplashScreen.hideAsync().catch(() => {});
    })();
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.surface },
                animation: "fade",
              }}
            />
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
